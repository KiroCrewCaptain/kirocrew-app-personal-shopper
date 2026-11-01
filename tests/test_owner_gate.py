"""The owner gate on Personal Shopper's nine write routes.

A dashboard caller (``app == ""``) or a request with no app claim must be the
dashboard owner, or it gets a 403 ``owner_only`` before any store or sites.json
write. An app token keeps its access: the token middleware has already confined
it to the routes its manifest grants. Reads stay open.

The gate itself is the host's (``ctx.require_owner``); ``FakeCtx`` stands in for
it, admitting only the configured ``owner_id``. What these pin is the app's half:
which routes ask, with which operation name, that the host's refusal is returned
unchanged, and that a gateway without the seam refuses every write, the owner's
included (fail closed).

No network: the store stays on its keyword path. All writes land in a tmpdir.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend import routes as routes_mod

from .harness import PREFIX, LegacyCtx, build_app, identity, make_ctx

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
        self, method: str, path: str, body, *, user: str, app, owner_id: str = OWNER, ctx=None
    ) -> tuple[int, dict]:
        server_app = build_app(
            ctx or self.ctx, middlewares=[identity(user, app)], owner_id=owner_id
        )
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

    async def test_the_host_refusal_is_what_the_caller_gets(self) -> None:
        """The gate's own response is returned as is, not rewritten to a 403."""
        self.ctx.refusal = lambda: web.json_response(
            {"error": "session predates the owner", "code": "auth_required"}, status=401
        )
        before = self.snapshot()
        status, payload = await self.request(
            "POST", "/groups", {"name": "Planted"}, user=NON_OWNER, app=""
        )
        self.assertEqual((status, payload.get("code")), (401, "auth_required"))
        self.assertEqual(self.snapshot(), before)

    async def test_no_configured_owner_refuses_every_dashboard_write(self) -> None:
        """The gate has no implicit owner here, so it fails closed."""
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


class TestTheHostGateDecides(OwnerGateTestCase):
    async def test_every_write_asks_the_host_gate_with_its_bare_operation(self) -> None:
        """The host prefixes the app name when it audits, so the app passes it bare."""
        expected = [
            "add_preference",
            "update_preference",
            "delete_preference",
            "reembed_preferences",
            "add_group",
            "delete_group",
            "add_history",
            "update_feedback",
            "put_sites",
        ]
        for (method, path, body), operation in zip(MUTATIONS, expected):
            with self.subTest(route=f"{method} {path}"):
                self.ctx.owner_checks.clear()
                await self.request(method, path, body, user=NON_OWNER, app="")
                self.assertEqual(self.ctx.owner_checks, [operation])

    async def test_reads_and_app_tokens_never_ask(self) -> None:
        for method, path, body in READS:
            await self.request(method, path, body, user=NON_OWNER, app="")
        await self.request("POST", "/groups", {"name": "Token"}, user="app:x", app="x")
        self.assertEqual(self.ctx.owner_checks, [])

    async def test_a_gateway_without_the_seam_refuses_every_write(self) -> None:
        """Below App Kit level 1 there is no owner gate to call, so nobody writes."""
        legacy = LegacyCtx(self._tmp)
        for method, path, body in MUTATIONS:
            with self.subTest(route=f"{method} {path}"):
                before = self.snapshot()
                status, payload = await self.request(
                    method, path, body, user=OWNER, app="", ctx=legacy
                )
                self.assertEqual((status, payload.get("code")), (403, "owner_only"))
                self.assertEqual(self.snapshot(), before)
        for method, path, body in READS:
            with self.subTest(route=f"{method} {path}"):
                status, _ = await self.request(method, path, body, user=OWNER, app="", ctx=legacy)
                self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
