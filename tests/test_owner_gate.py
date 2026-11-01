"""The owner gate on Personal Shopper's nine write routes.

A dashboard caller (``app == ""``) or a request with no app claim must be the
dashboard owner, or it gets a 403 ``owner_only`` before any store or sites.json
write. An app token keeps its access: the token middleware has already confined
it to the routes its manifest grants. Reads stay open.

Without Kiro Crew installed these exercise the fallback gate in
``backend/_host.py``, which admits only a caller equal to the configured
``owner_id``. Inside a gateway the host's own gate runs instead; the last case
pins that the fallback refuses everyone when no owner is configured, so it can
never be more permissive than the host.

No network: the store stays on its keyword path. All writes land in a tmpdir.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import TestClient, TestServer

from backend import _host
from backend import routes as routes_mod
from backend import store as store_mod

from .harness import PREFIX, build_app, identity, make_ctx

OWNER = "owner-1"
NON_OWNER = "allowlisted-2"

MUTATIONS = [
    ("POST", "/preferences", {"text": "planted"}),
    ("PUT", "/preferences/{pref}", {"text": "rewritten"}),
    ("DELETE", "/preferences/{pref}", None),
    ("POST", "/preferences/reembed", {}),
    ("POST", "/groups", {"name": "Planted"}),
    ("DELETE", "/groups/{group}", None),
    ("POST", "/history", {"problem": "planted"}),
    ("PUT", "/history/{hist}/feedback", {"product": "Shoe A", "feedback": "purchased"}),
    ("PUT", "/sites", {"sites": [{"id": "x", "name": "Other", "url": "https://other.example"}]}),
]

READS = [
    ("GET", "/preferences", None),
    ("POST", "/preferences/search", {"query": "shoe"}),
    ("GET", "/groups", None),
    ("GET", "/history", None),
    ("GET", "/sites", None),
]


class OwnerGateTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self._tmp, True)
        patcher = mock.patch.object(store_mod, "get_shared_embedder", None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.ctx = make_ctx(self._tmp)
        self.addAsyncCleanup(routes_mod.on_shutdown, self.ctx)

        store = await routes_mod._get_store(self.ctx)
        self.ids = {
            "pref": store.add("allergic to latex; shoe size US 10", tags=[]),
            "group": store.add_group("Running"),
            "hist": store.add_history("knee pain on runs", products=[{"name": "Shoe A"}]),
        }
        self.sites_file = routes_mod._sites_path(self.ctx)
        self.sites_file.write_text(
            json.dumps(
                {"sites": [{"id": "s1", "name": "Owner Shop", "url": "https://shop.example"}]}
            ),
            encoding="utf-8",
        )

    def snapshot(self) -> tuple[list[str], bytes]:
        # A second connection sees committed rows (WAL included), so this is the
        # whole persisted store, not the in-process view of it.
        conn = sqlite3.connect(self._tmp / "preferences.db")
        try:
            rows = list(conn.iterdump())
        finally:
            conn.close()
        return rows, self.sites_file.read_bytes()

    async def request(
        self, method: str, path: str, body, *, user: str, app, owner_id: str = OWNER
    ) -> tuple[int, dict]:
        server_app = build_app(self.ctx, middlewares=[identity(user, app)], owner_id=owner_id)
        async with TestClient(TestServer(server_app)) as client:
            resp = await client.request(method, PREFIX + path.format(**self.ids), json=body)
            return resp.status, await resp.json()


class TestWritesAreOwnerOnly(OwnerGateTestCase):
    async def test_non_owner_dashboard_caller_is_refused_and_nothing_changes(self) -> None:
        for method, path, body in MUTATIONS:
            with self.subTest(route=f"{method} {path}"):
                before = self.snapshot()
                status, payload = await self.request(method, path, body, user=NON_OWNER, app="")
                self.assertEqual((status, payload.get("code")), (403, "owner_only"))
                self.assertEqual(self.snapshot(), before)

    async def test_missing_app_claim_is_refused_and_nothing_changes(self) -> None:
        for method, path, body in MUTATIONS:
            with self.subTest(route=f"{method} {path}"):
                before = self.snapshot()
                status, payload = await self.request(method, path, body, user=OWNER, app=None)
                self.assertEqual((status, payload.get("code")), (403, "owner_only"))
                self.assertEqual(self.snapshot(), before)

    async def test_no_configured_owner_refuses_every_dashboard_write(self) -> None:
        """The fallback has no implicit owner, so it fails closed."""
        for method, path, body in MUTATIONS:
            with self.subTest(route=f"{method} {path}"):
                before = self.snapshot()
                status, payload = await self.request(
                    method, path, body, user=OWNER, app="", owner_id=""
                )
                self.assertEqual((status, payload.get("code")), (403, "owner_only"))
                self.assertEqual(self.snapshot(), before)

    async def test_allowed_callers_still_write(self) -> None:
        callers = {
            "owner": (OWNER, ""),
            "own-app-token": ("app:personal-shopper", "personal-shopper"),
            "foreign-token-granted-by-middleware": ("app:granted", "granted-app"),
        }
        for label, (user, app) in callers.items():
            for method, path, body in MUTATIONS:
                with self.subTest(caller=label, route=f"{method} {path}"):
                    # A DELETE consumes its target, so each case gets fresh ids.
                    await self.asyncSetUp()
                    status, payload = await self.request(method, path, body, user=user, app=app)
                    self.assertTrue(200 <= status < 300, (status, payload))

    async def test_owner_write_lands(self) -> None:
        status, _ = await self.request(
            "PUT", "/preferences/{pref}", {"text": "size US 11"}, user=OWNER, app=""
        )
        self.assertEqual(status, 200)
        store = await routes_mod._get_store(self.ctx)
        self.assertEqual(store.list_all()[0]["text"], "size US 11")

    async def test_non_owner_reads_are_unchanged(self) -> None:
        for method, path, body in READS:
            with self.subTest(route=f"{method} {path}"):
                status, _ = await self.request(method, path, body, user=NON_OWNER, app="")
                self.assertEqual(status, 200)


class TestHostGateIsPreferred(OwnerGateTestCase):
    async def test_the_host_gate_decides_when_kiro_crew_is_importable(self) -> None:
        """Inside a gateway the host's gate must run, not the local fallback."""
        calls: list[str] = []

        async def host_gate(request, operation):
            calls.append(operation)
            return None

        fake = mock.MagicMock(require_owner_dashboard_request=host_gate)
        # Only the leaf module: a ``from a.b.c import x`` is served straight from
        # ``sys.modules[a.b.c]``, and leaving ``kiro_crew`` itself absent keeps
        # the AppRoute import on its local fallback, as in every other test.
        with mock.patch.dict("sys.modules", {"kiro_crew.dashboard.handlers._shared": fake}):
            # A non-owner the fallback would refuse is admitted, so the host ran.
            status, _ = await self.request(
                "POST", "/groups", {"name": "Via host"}, user=NON_OWNER, app=""
            )
        self.assertEqual(status, 201)
        self.assertEqual(calls, ["personal_shopper.add_group"])
        self.assertTrue(callable(_host.require_owner))


if __name__ == "__main__":
    unittest.main()
