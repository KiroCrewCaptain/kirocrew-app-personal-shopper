"""Tests for the Personal Shopper HTTP routes.

The load-bearing ones here pin the boundary between a CLIENT error and a SERVER
error. A field these handlers read must not go straight into a string or int
operation: a wrong TYPE — not a wrong value — then raises inside the handler and
surfaces as a 500. A 500 tells a caller "the server is broken" and is what gets
paged on; the correct answer to ``{"text": 1}`` is a 400 naming the offending
field, which is what these assert.

They also pin that every error body carries a machine-readable ``code``: the
dashboard renders ``error`` verbatim into a localized UI, so prose alone is
untranslatable by construction.
"""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from backend import _host
from backend import routes as routes_mod

from .harness import PREFIX as _PREFIX
from .harness import FakeEmbed, LegacyCtx, build_app, identity, make_ctx

_OWNER = "owner-user"


class RoutesTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.mkdtemp()
        # Registered first so it runs last: the store's connection must close
        # before the directory holding its database is removed.
        self.addCleanup(self._rmtree)

        # Every byte this app writes goes under ``ctx.data_dir``, so pointing it
        # at the tmpdir is the whole isolation: the store and sites.json both
        # land there, and nothing resolves a data home of its own.
        self.ctx = make_ctx(Path(self._tmp))
        self.addAsyncCleanup(routes_mod.on_shutdown, self.ctx)

        app = build_app(self.ctx, middlewares=[identity(_OWNER, "")], owner_id=_OWNER)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()

    def _rmtree(self) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)


class TestBodyShapeIsAClientError(RoutesTestCase):
    async def test_a_non_object_body_is_a_400_not_a_500(self) -> None:
        """A JSON array parses fine but has no ``.get``.

        Without the object check every handler raises ``AttributeError`` and the
        client sees a 500 for what is purely a malformed request.
        """
        resp = await self.client.post(f"{_PREFIX}/preferences", json=[1, 2, 3])
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "body_not_object")

    async def test_a_non_string_text_is_a_400_not_a_500(self) -> None:
        """``{"text": 1}`` must never reach ``.strip()``."""
        resp = await self.client.post(f"{_PREFIX}/preferences", json={"text": 1})
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_non_string_tag_elements_are_rejected_at_the_boundary(self) -> None:
        """A non-string tag would otherwise fail deep inside sqlite/FTS."""
        resp = await self.client.post(
            f"{_PREFIX}/preferences", json={"text": "shoe size US 10", "tags": [1]}
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_a_missing_text_names_the_field(self) -> None:
        resp = await self.client.post(f"{_PREFIX}/preferences", json={})
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "missing_required_field")

    async def test_a_valid_preference_is_created(self) -> None:
        resp = await self.client.post(
            f"{_PREFIX}/preferences", json={"text": "shoe size US 10", "tags": ["body"]}
        )
        self.assertEqual(resp.status, 201)
        self.assertTrue((await resp.json())["id"])


def _req_raising(exc: Exception) -> web.Request:
    """A real ``web.Request`` whose ``.json()`` raises *exc*.

    ``_json_object`` only calls ``request.json``, so overriding it on a mocked
    request exercises the catch directly without wiring a full transport.
    """
    request = make_mocked_request("POST", f"{_PREFIX}/preferences")

    async def _json(*_args: object, **_kwargs: object) -> object:
        raise exc

    request.json = _json  # type: ignore[method-assign]
    return request


class TestJsonObjectCatchWidth(unittest.IsolatedAsyncioTestCase):
    """The catch must span the client-input failure set, not ValueError alone."""

    async def test_an_unknown_charset_codec_is_a_400_not_a_500(self) -> None:
        # An unknown ``charset=`` on the request makes aiohttp's decode step raise
        # LookupError (not a ValueError), which escapes ``_json_object`` as a 500
        # unless it is caught. It is a client-input mistake and must answer 400.
        body, err = await routes_mod._json_object(
            _req_raising(LookupError("unknown encoding: bogus-codec"))
        )
        self.assertIsNone(body)
        assert err is not None
        self.assertEqual(err.status, 400)

    async def test_a_recursion_error_from_a_deep_body_is_a_400(self) -> None:
        body, err = await routes_mod._json_object(_req_raising(RecursionError()))
        self.assertIsNone(body)
        assert err is not None
        self.assertEqual(err.status, 400)


class TestSearchArgumentValidation(RoutesTestCase):
    async def test_a_boolean_top_k_is_rejected(self) -> None:
        """``isinstance(True, int)`` is True in Python.

        Without the explicit bool exclusion ``top_k=true`` silently becomes a
        LIMIT of 1 and the caller gets one result while believing it asked for a
        page of them.
        """
        resp = await self.client.post(
            f"{_PREFIX}/preferences/search", json={"query": "gift", "top_k": True}
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_an_out_of_range_top_k_is_rejected(self) -> None:
        resp = await self.client.post(
            f"{_PREFIX}/preferences/search", json={"query": "gift", "top_k": 0}
        )
        self.assertEqual(resp.status, 400)

    async def test_search_reports_its_ranking_mode(self) -> None:
        """Callers must be able to tell a cosine score from a keyword rank."""
        await self.client.post(f"{_PREFIX}/preferences", json={"text": "likes vinyl"})
        resp = await self.client.post(f"{_PREFIX}/preferences/search", json={"query": "vinyl"})
        self.assertEqual(resp.status, 200)
        self.assertIn("semantic", await resp.json())


class TestQueryParamValidation(RoutesTestCase):
    async def test_a_non_numeric_limit_is_a_400_not_a_500(self) -> None:
        """``int("abc")`` raises: an unvalidated query param is still input."""
        resp = await self.client.get(f"{_PREFIX}/history?limit=abc")
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_an_out_of_range_limit_is_rejected(self) -> None:
        resp = await self.client.get(f"{_PREFIX}/history?limit=100000")
        self.assertEqual(resp.status, 400)


class TestFeedbackIsConstrained(RoutesTestCase):
    async def test_an_unknown_feedback_value_is_rejected(self) -> None:
        """Only the three states the UI can render may be persisted.

        Anything else would round-trip to the badge and display as a raw English
        string in every locale.
        """
        created = await self.client.post(f"{_PREFIX}/history", json={"problem": "neck aches"})
        history_id = (await created.json())["id"]
        resp = await self.client.put(
            f"{_PREFIX}/history/{history_id}/feedback",
            json={"product": "Monitor arm", "feedback": "maybe"},
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_a_known_feedback_value_is_accepted(self) -> None:
        created = await self.client.post(f"{_PREFIX}/history", json={"problem": "neck aches"})
        history_id = (await created.json())["id"]
        resp = await self.client.put(
            f"{_PREFIX}/history/{history_id}/feedback",
            json={"product": "Monitor arm", "feedback": "purchased"},
        )
        self.assertEqual(resp.status, 200)


class TestSitesShapeValidation(RoutesTestCase):
    async def test_get_treats_a_vanished_sites_file_as_empty(self) -> None:
        """Deleting sites.json during discovery must not turn GET into a 500."""
        sites_file = routes_mod._sites_path(self.ctx)
        sites_file.write_text('{"sites": []}', encoding="utf-8")
        real_read_bytes = Path.read_bytes

        def vanish_before_read(path, *args, **kwargs):
            if path == sites_file:
                path.unlink()
                raise FileNotFoundError(path)
            return real_read_bytes(path, *args, **kwargs)

        with mock.patch.object(Path, "read_bytes", vanish_before_read):
            resp = await self.client.get(f"{_PREFIX}/sites")

        self.assertEqual(resp.status, 200)
        self.assertEqual(await resp.json(), {"sites": []})

    async def test_get_treats_a_malformed_sites_file_as_empty(self) -> None:
        """A hand-edited sites.json that is not JSON must not turn GET into a 500."""
        routes_mod._sites_path(self.ctx).write_text('{"sites": [', encoding="utf-8")

        resp = await self.client.get(f"{_PREFIX}/sites")

        self.assertEqual(resp.status, 200)
        self.assertEqual(await resp.json(), {"sites": []})

    async def test_get_treats_an_undecodable_sites_file_as_empty(self) -> None:
        """A latin-1 sites.json (e.g. a restored backup) must not turn GET into a 500."""
        routes_mod._sites_path(self.ctx).write_bytes(
            '{"sites": [{"id": "a", "name": "Caf\u00e9", "url": "x"}]}'.encode("latin-1")
        )

        resp = await self.client.get(f"{_PREFIX}/sites")

        self.assertEqual(resp.status, 200)
        self.assertEqual(await resp.json(), {"sites": []})

    async def test_sites_must_be_an_array_of_objects(self) -> None:
        resp = await self.client.put(f"{_PREFIX}/sites", json={"sites": ["amazon"]})
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_a_missing_sites_key_is_rejected(self) -> None:
        resp = await self.client.put(f"{_PREFIX}/sites", json={})
        self.assertEqual(resp.status, 400)


class TestReembedIsReachable(RoutesTestCase):
    async def test_reembed_has_a_route(self) -> None:
        """The store drops vectors whenever no model is serving.

        That is the normal state on a fresh install, so without a reachable
        rebuild path those entries keep scoring 0 even after the model lands and
        semantic search stays permanently dormant for them.
        """
        resp = await self.client.post(f"{_PREFIX}/preferences/reembed")
        self.assertEqual(resp.status, 200)
        self.assertIn("reembedded", await resp.json())


class TestRouteTableMatchesTheBuiltin(unittest.TestCase):
    """The external app serves exactly the built-in's fourteen routes.

    The dashboard page calls these paths by name, so a route dropped in the port
    is a tab that silently fails. The built-in's own enable gate is gone on
    purpose: the gateway's RouteRegistry dispatches an app's routes only while
    it is enabled, so a disabled app answers 404 without any check here.
    """

    def test_the_method_and_path_set_is_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            table = {(r.method, r.path) for r in routes_mod.register_routes(make_ctx(Path(tmp)))}
            # Registration must not create the store: that is first-request work.
            self.assertEqual(list(Path(tmp).iterdir()), [])
        self.assertEqual(
            table,
            {
                ("GET", "/preferences"),
                ("POST", "/preferences"),
                ("PUT", "/preferences/{id}"),
                ("DELETE", "/preferences/{id}"),
                ("POST", "/preferences/search"),
                ("POST", "/preferences/reembed"),
                ("GET", "/groups"),
                ("POST", "/groups"),
                ("DELETE", "/groups/{id}"),
                ("GET", "/history"),
                ("POST", "/history"),
                ("PUT", "/history/{id}/feedback"),
                ("GET", "/sites"),
                ("PUT", "/sites"),
            },
        )


class TestNestedRecordFieldsAreValidated(RoutesTestCase):
    """The outer "is it a dict" check is not enough.

    An object-valued ``name`` is itself a dict, so it passed the outer check, got
    persisted, and came back to React -- which throws when handed an object as a
    child. That takes down the whole app page on every later visit, because the
    bad value is stored.
    """

    async def test_an_object_valued_product_name_is_rejected(self) -> None:
        resp = await self.client.post(
            f"{_PREFIX}/history",
            json={"problem": "gift", "products": [{"name": {"nested": "object"}}]},
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_a_non_numeric_product_price_is_rejected(self) -> None:
        """``price`` is formatted through ``fmtCurrency``, so it must be a number."""
        resp = await self.client.post(
            f"{_PREFIX}/history",
            json={"problem": "gift", "products": [{"name": "Book", "price": "forty"}]},
        )
        self.assertEqual(resp.status, 400)

    async def test_a_boolean_product_price_is_rejected(self) -> None:
        """``bool`` is a subclass of ``int``: ``price: true`` would format as 1."""
        resp = await self.client.post(
            f"{_PREFIX}/history",
            json={"problem": "gift", "products": [{"name": "Book", "price": True}]},
        )
        self.assertEqual(resp.status, 400)

    async def test_a_product_without_a_name_is_rejected(self) -> None:
        resp = await self.client.post(
            f"{_PREFIX}/history", json={"problem": "gift", "products": [{"price": 10}]}
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "missing_required_field")

    async def test_a_well_formed_product_is_accepted(self) -> None:
        resp = await self.client.post(
            f"{_PREFIX}/history",
            json={
                "problem": "gift",
                "products": [{"name": "The Eras Tour Book", "price": 40.0}],
            },
        )
        self.assertEqual(resp.status, 201)

    async def test_an_object_valued_site_name_is_rejected(self) -> None:
        resp = await self.client.put(
            f"{_PREFIX}/sites",
            json={"sites": [{"id": "a", "name": {"x": 1}, "url": "store.example.com"}]},
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "invalid_field_type")

    async def test_a_non_boolean_enabled_flag_is_rejected(self) -> None:
        resp = await self.client.put(
            f"{_PREFIX}/sites",
            json={
                "sites": [
                    {
                        "id": "a",
                        "name": "Example Store",
                        "url": "store.example.com",
                        "enabled": "yes",
                    }
                ]
            },
        )
        self.assertEqual(resp.status, 400)

    async def test_a_site_missing_its_id_is_rejected(self) -> None:
        resp = await self.client.put(
            f"{_PREFIX}/sites",
            json={"sites": [{"name": "Example Store", "url": "store.example.com"}]},
        )
        self.assertEqual(resp.status, 400)
        self.assertEqual((await resp.json())["code"], "missing_required_field")

    async def test_a_well_formed_site_is_accepted(self) -> None:
        resp = await self.client.put(
            f"{_PREFIX}/sites",
            json={
                "sites": [
                    {
                        "id": "abc123",
                        "name": "Example Store",
                        "url": "store.example.com",
                        "enabled": True,
                        "loggedIn": False,
                    }
                ]
            },
        )
        self.assertEqual(resp.status, 200)


class TestTheSuiteHasNoSideEffects(RoutesTestCase):
    """A test must not write outside its own temporary directory.

    This is not hypothetical: in the built-in the sites handlers resolved the data
    home themselves, so a fixture that patched only the store left ``PUT /sites``
    writing sites.json into the OPERATOR'S real ``~/.kiro/crew`` every time the
    suite ran. Here every path derives from ``ctx.data_dir``; this test fails if
    any write stops doing so.
    """

    async def test_writing_sites_stays_inside_the_tmpdir(self) -> None:
        resp = await self.client.put(
            f"{_PREFIX}/sites",
            json={
                "sites": [
                    {
                        "id": "abc123",
                        "name": "Example Store",
                        "url": "store.example.com",
                        "enabled": True,
                        "loggedIn": False,
                    }
                ]
            },
        )
        self.assertEqual(resp.status, 200)

        written = routes_mod._sites_path(self.ctx)
        self.assertTrue(written.exists(), "the write did not land at all")
        self.assertTrue(
            str(written).startswith(self._tmp),
            f"sites.json escaped the tmpdir and landed at {written}",
        )

    async def test_the_real_data_home_is_never_resolved(self) -> None:
        """The sites path must not be the operator's home under any spelling.

        Compared through ``as_posix()`` rather than ``str()``: ``str()`` of a
        resolved path spells the separator the way the host does, so on Windows
        the forward-slash needles could never match and this guard went green
        even if the write HAD escaped into the operator's real data home. The
        containment assertion is the positive form of the same claim and depends
        on no separator spelling at all.
        """
        resolved = routes_mod._sites_path(self.ctx).resolve()
        spelling = resolved.as_posix()
        self.assertNotIn(".kiro/crew/apps", spelling)
        self.assertNotIn(".kirocrew/apps", spelling)
        self.assertTrue(
            resolved.is_relative_to(Path(self._tmp).resolve()),
            f"sites.json resolved outside the tmpdir and landed at {resolved}",
        )


class TestEmbedWorkUsesTheHostPool(unittest.IsolatedAsyncioTestCase):
    """Embed-heavy store calls go to ``ctx.embed.run``, the host's bounded pool.

    They call a synchronous embedder that can block for a long time; on the
    shared default executor they would starve every fast offload the gateway
    makes. A gateway without the seam still serves them, on ``to_thread``.
    """

    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self._tmp, True)

    async def _client(self, ctx) -> TestClient:
        self.addAsyncCleanup(routes_mod.on_shutdown, ctx)
        app = build_app(ctx, middlewares=[identity(_OWNER, "")], owner_id=_OWNER)
        client = TestClient(TestServer(app))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    async def test_each_embedding_route_runs_on_the_host_pool(self) -> None:
        embed = FakeEmbed()
        ctx = make_ctx(Path(self._tmp), embed=embed)
        client = await self._client(ctx)

        resp = await client.post(f"{_PREFIX}/preferences", json={"text": "wide toe box"})
        entry_id = (await resp.json())["id"]
        resp = await client.post(f"{_PREFIX}/preferences/search", json={"query": "wide toe box"})
        body = await resp.json()
        await client.put(f"{_PREFIX}/preferences/{entry_id}", json={"text": "wide toe box shoes"})
        await client.post(f"{_PREFIX}/preferences/reembed")
        await client.get(f"{_PREFIX}/preferences")

        self.assertEqual(embed.offloaded, ["add", "search", "update", "reembed_all"])
        # The vector path served the search: the SDK's vectors reached the store.
        self.assertTrue(body["semantic"])
        self.assertEqual(body["results"][0]["id"], entry_id)

    async def test_a_gateway_without_the_seam_ranks_by_keyword(self) -> None:
        ctx = LegacyCtx(Path(self._tmp))
        client = await self._client(ctx)
        # No owner gate either, so seed through the store, then read.
        store = await routes_mod._get_store(ctx)
        store.add("allergic to latex")
        resp = await client.post(f"{_PREFIX}/preferences/search", json={"query": "latex"})
        self.assertEqual(resp.status, 200)
        body = await resp.json()
        self.assertFalse(body["semantic"])
        self.assertEqual([r["text"] for r in body["results"]], ["allergic to latex"])


class TestRouteRecordsAreStructural(unittest.TestCase):
    """The routes hook returns the app's own records, not a host class.

    A level-1 ``RouteRegistry`` accepts any object with a str ``method`` (GET,
    POST, PUT, DELETE or PATCH), a str ``path`` and a callable ``handler``.
    """

    def test_every_record_has_the_shape_the_registry_accepts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            records = routes_mod.register_routes(make_ctx(Path(tmp)))
        for record in records:
            with self.subTest(route=f"{record.method} {record.path}"):
                self.assertIsInstance(record, _host.Route)
                self.assertIn(record.method, {"GET", "POST", "PUT", "DELETE", "PATCH"})
                self.assertTrue(record.path.startswith("/") and len(record.path) <= 512)
                self.assertTrue(callable(record.handler))


class TestAnOlderGatewayIsReportedDegraded(unittest.TestCase):
    def test_below_level_1_the_routes_still_register_and_health_says_why(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = LegacyCtx(Path(tmp))
            records = routes_mod.register_routes(ctx)
        self.assertEqual(len(records), 14)
        self.assertEqual(ctx.health.status, "degraded")
        self.assertEqual(len(ctx.health.issues), 1)
        self.assertIn("App Kit level 1", ctx.health.issues[0])

    def test_a_level_1_gateway_stays_healthy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = make_ctx(Path(tmp))
            routes_mod.register_routes(ctx)
        self.assertEqual((ctx.health.status, ctx.health.issues), ("healthy", []))

    def test_a_context_without_health_is_tolerated(self) -> None:
        class _Bare:
            def __init__(self, data_dir: Path) -> None:
                self.data_dir = data_dir

        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(len(routes_mod.register_routes(_Bare(Path(tmp)))), 14)


if __name__ == "__main__":
    unittest.main()
