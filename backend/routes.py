"""Personal Shopper — backend API routes, as an external app's ``hooks.routes``.

``register_routes(ctx)`` returns the routes as ``AppRoute`` records, which the
gateway's ``RouteRegistry`` serves under ``/api/apps/personal-shopper/<path>``
while the app is enabled. The registry deregisters them on disable, so there is
no enable check here: a disabled app's routes are simply not dispatched.

Routes (browser-facing, same-origin authed). Every write is owner-only from the
dashboard; an app token admitted by its manifest grant keeps its access:

  GET    /preferences                -> list all preferences
  POST   /preferences                -> add a preference
  PUT    /preferences/{id}           -> update a preference
  DELETE /preferences/{id}           -> delete a preference
  POST   /preferences/search         -> RAG search
  POST   /preferences/reembed        -> rebuild missing vectors

  GET    /groups                     -> list groups
  POST   /groups                     -> add a group
  DELETE /groups/{id}                -> delete a group

  GET    /history                    -> list history
  POST   /history                    -> add history entry
  PUT    /history/{id}/feedback      -> update feedback

  GET    /sites                      -> get sites config
  PUT    /sites                      -> update sites config
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from functools import wraps
from pathlib import Path
from typing import Any, Awaitable, Callable

from aiohttp import web

from . import _host
from ._fs import atomic_write, mkdirs_owner_only, read_json_or
from .store import PreferenceStore, db_path_in

logger = logging.getLogger(__name__)

APP_NAME = "personal-shopper"

Handler = Callable[[web.Request, Any], Awaitable[web.Response]]

# Built on first request, not at import or registration: constructing the store
# creates the data directory and runs sqlite DDL, which must not happen merely
# because the module was loaded.
_store: PreferenceStore | None = None
# A THREADING lock, taken inside the worker thread that builds the store. An
# asyncio lock is bound to the loop it was first awaited on, and this module
# outlives loops (a gateway restart in-process, every test case); the built-in
# needed Kiro Crew's ``LoopBoundLock`` for exactly that, which an external app
# cannot import.
_store_lock = threading.Lock()


def _build_store(data_dir: Path) -> PreferenceStore:
    """Return the singleton, building it once. Runs off the event loop.

    The second check inside the lock is what makes concurrent first requests
    build it once: two threads can both see ``None`` before either takes it.
    A singleton for a different data directory is replaced rather than reused,
    so a context handed a new ``data_dir`` never writes into the old one.
    """
    global _store
    with _store_lock:
        current = _store
        wanted = db_path_in(data_dir)
        if current is not None and current.db_path == wanted:
            return current
        _store = PreferenceStore(wanted)
        if current is not None:
            current.close()
        return _store


async def _get_store(ctx: Any) -> PreferenceStore:
    current = _store
    if current is not None and current.db_path == db_path_in(ctx.data_dir):
        return current
    return await asyncio.to_thread(_build_store, Path(ctx.data_dir))


def _bad_request(error: str, code: str) -> web.Response:
    """A 400 carrying both prose and a machine-readable code.

    The dashboard renders ``error`` verbatim into a localized UI, so ``code`` is
    the contract and the prose is advisory (RFC 9457 3.1.3).
    """
    return web.json_response({"error": error, "code": code}, status=400)


def _reject_non_finite(value: str) -> Any:
    """Refuse ``NaN`` / ``Infinity`` / ``-Infinity``.

    Python's json module accepts those three as an extension, and dumps them back
    out verbatim -- but they are not valid JSON, so ``JSON.parse`` in the browser
    throws on the stored file. A single NaN price therefore makes the whole
    sites/history record unreadable to the dashboard, hiding data that is still
    on disk. Rejecting at the boundary keeps them from ever being persisted.
    """
    raise ValueError(f"non-finite number not allowed: {value}")


def _strict_loads(text: str) -> Any:
    return json.loads(text, parse_constant=_reject_non_finite)


async def _json_object(
    request: web.Request,
) -> tuple[dict[str, Any] | None, web.Response | None]:
    """Parse the body and require it to be a JSON object.

    Returns ``(body, None)`` or ``(None, error_response)``. A bare scalar or
    array parses fine as JSON but has no ``.get``, so without this check every
    handler would raise ``AttributeError`` and return a 500 to a client that
    merely sent the wrong shape.

    Follows the ``dashboard/handlers/_shared.read_bounded_json`` contract on
    Q1/Q2 (400 for a non-object, catch spanning the client-input failure set).
    The deliberate divergence is ``_strict_loads``: ``parse_constant`` rejects
    ``NaN``/``Infinity``/``-Infinity`` at the boundary (see ``_reject_non_finite``)
    so a non-finite number can never be persisted into a record the browser's
    ``JSON.parse`` would then choke on. The catch is widened past
    ``ValueError`` to include ``LookupError`` (an unknown ``charset=`` codec) and
    ``RecursionError`` (a deeply nested body) so those become a 400, not a 500,
    while a mid-read transport error still propagates.
    """
    try:
        body = await request.json(loads=_strict_loads)
    except (LookupError, RecursionError, ValueError):
        return None, _bad_request("invalid JSON", "invalid_json")
    if not isinstance(body, dict):
        return None, _bad_request("body must be a JSON object", "body_not_object")
    return body, None


def _opt_str(body: dict[str, Any], key: str) -> tuple[str | None, web.Response | None]:
    """Read an optional string field, rejecting a non-string outright.

    ``{"text": 1}`` must not reach ``.strip()`` -- that raises and turns a client
    type error into a server error.
    """
    if key not in body or body[key] is None:
        return None, None
    value = body[key]
    if not isinstance(value, str):
        return None, _bad_request(f"{key} must be a string", "invalid_field_type")
    return value, None


def _req_str(body: dict[str, Any], key: str) -> tuple[str, web.Response | None]:
    """Read a required, non-empty string field."""
    value, err = _opt_str(body, key)
    if err is not None:
        return "", err
    if not (value or "").strip():
        return "", _bad_request(f"{key} is required", "missing_required_field")
    return (value or "").strip(), None


def _opt_str_list(body: dict[str, Any], key: str) -> tuple[list[str] | None, web.Response | None]:
    """Read an optional list-of-strings field.

    Element types are checked too: the store writes tags into FTS and a non-string
    element would fail deep inside sqlite rather than at the boundary.
    """
    if key not in body or body[key] is None:
        return None, None
    value = body[key]
    if not isinstance(value, list):
        return None, _bad_request(f"{key} must be an array", "invalid_field_type")
    if not all(isinstance(v, str) for v in value):
        return None, _bad_request(f"{key} must contain only strings", "invalid_field_type")
    return value, None


def _owner_only(operation: str, handler: Handler) -> Handler:
    """Refuse a non-owner dashboard caller before a write runs.

    A dashboard request (``app == ""``) or one with no app claim at all goes
    through the owner gate and its 403 ``owner_only``. An app token keeps the
    built-in's result: the token middleware has already confined it to the
    routes its manifest ``permissions.api`` grants.
    """

    @wraps(handler)
    async def _wrapped(request: web.Request, ctx: Any) -> web.Response:
        if not request.get("app"):
            denied = await _host.require_owner(request, f"personal_shopper.{operation}")
            if denied is not None:
                return denied
        return await handler(request, ctx)

    return _wrapped


def _check_records(
    items: list[Any], key: str, spec: dict[str, tuple[type, ...]], required: tuple[str, ...]
) -> web.Response | None:
    """Validate each record's fields against the shape the frontend renders.

    Returns an error response, or ``None`` when every record is acceptable. The
    outer "is it a dict" check is not enough: an object-valued ``name`` is a dict
    too, and React throws when it is handed an object as a child -- a malformed
    request would take down the app page for every later visit, because the bad
    value is persisted.
    """
    for index, item in enumerate(items):
        for field in required:
            if field not in item:
                return _bad_request(f"{key}[{index}].{field} is required", "missing_required_field")
        for field, value in item.items():
            allowed = spec.get(field)
            if allowed is None:
                continue  # forward-compatible: unknown fields are not rendered
            # bool is a subclass of int, so a numeric field must exclude it or
            # ``price: true`` would format as the number 1.
            if isinstance(value, bool) and bool not in allowed:
                return _bad_request(
                    f"{key}[{index}].{field} has the wrong type", "invalid_field_type"
                )
            if not isinstance(value, allowed):
                return _bad_request(
                    f"{key}[{index}].{field} has the wrong type", "invalid_field_type"
                )
    return None


# Field shapes the UI renders. `price` is formatted through fmtCurrency, so it
# must be a real number; `name`/`url` are rendered as text.
_PRODUCT_SPEC: dict[str, tuple[type, ...]] = {
    "name": (str,),
    "url": (str,),
    "price": (int, float),
    "feedback": (str,),
}
_SITE_SPEC: dict[str, tuple[type, ...]] = {
    "id": (str,),
    "name": (str,),
    "url": (str,),
    "enabled": (bool,),
    "loggedIn": (bool,),
}


# ── Preferences ──


async def _handle_list_preferences(request: web.Request, ctx: Any) -> web.Response:
    store = await _get_store(ctx)
    prefs = await asyncio.to_thread(store.list_all)
    return web.json_response({"preferences": prefs})


async def _handle_add_preference(request: web.Request, ctx: Any) -> web.Response:
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    text, err = _req_str(body, "text")
    if err is not None:
        return err

    tags, err = _opt_str_list(body, "tags")
    if err is not None:
        return err

    store = await _get_store(ctx)
    entry_id = await _host.run_in_embed_pool(store.add, text, tags=tags or [])
    return web.json_response({"id": entry_id}, status=201)


async def _handle_update_preference(request: web.Request, ctx: Any) -> web.Response:
    entry_id = request.match_info["id"]
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    text, err = _opt_str(body, "text")
    if err is not None:
        return err

    tags, err = _opt_str_list(body, "tags")
    if err is not None:
        return err

    store = await _get_store(ctx)
    # ``store.update`` re-embeds whenever ``text`` is supplied (the store's
    # UPDATE writes ``_embed(new_text)``), so it belongs on the same bulkhead
    # as add/search/reembed. A tags-only update does not embed, but routing on
    # the worst case is what keeps the shared default pool free.
    await _host.run_in_embed_pool(store.update, entry_id, text=text, tags=tags)
    return web.json_response({"id": entry_id, "updated": True})


async def _handle_delete_preference(request: web.Request, ctx: Any) -> web.Response:
    entry_id = request.match_info["id"]
    store = await _get_store(ctx)
    await asyncio.to_thread(store.delete, entry_id)
    return web.json_response({"id": entry_id, "deleted": True})


async def _handle_search_preferences(request: web.Request, ctx: Any) -> web.Response:
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    query, err = _req_str(body, "query")
    if err is not None:
        return err

    # A bool is an int in Python, so ``isinstance(True, int)`` passes -- exclude it
    # explicitly rather than letting ``top_k=true`` become a LIMIT of 1.
    top_k = body.get("top_k", 5)
    if isinstance(top_k, bool) or not isinstance(top_k, int):
        return _bad_request("top_k must be an integer", "invalid_field_type")
    if not 1 <= top_k <= 100:
        return _bad_request("top_k must be between 1 and 100", "invalid_field_type")

    tag_filter, err = _opt_str_list(body, "tag_filter")
    if err is not None:
        return err

    store = await _get_store(ctx)
    results = await _host.run_in_embed_pool(store.search, query, top_k=top_k, tag_filter=tag_filter)
    return web.json_response(
        {
            # `semantic` tells the caller whether `score` is a cosine similarity
            # or a keyword-rank ordering, so a client never thresholds a keyword
            # score as though it measured meaning.
            "semantic": bool(results and results[0].semantic),
            "results": [
                {
                    "id": r.id,
                    "text": r.text,
                    "tags": r.tags,
                    "score": r.score,
                    "semantic": r.semantic,
                }
                for r in results
            ],
        }
    )


async def _handle_reembed_preferences(request: web.Request, ctx: Any) -> web.Response:
    """Rebuild vectors for entries that have none.

    Reachable because the store deliberately drops a vector whenever no model is
    serving -- the normal state on a fresh install, before the embedding model has
    been downloaded. Without a rebuild path those entries would keep scoring 0
    even after the model lands, leaving semantic search permanently dormant for
    everything added in the meantime.
    """
    store = await _get_store(ctx)
    count = await _host.run_in_embed_pool(store.reembed_all)
    return web.json_response({"reembedded": count})


# ── Groups ──


async def _handle_list_groups(request: web.Request, ctx: Any) -> web.Response:
    store = await _get_store(ctx)
    groups = await asyncio.to_thread(store.list_groups)
    return web.json_response({"groups": groups})


async def _handle_add_group(request: web.Request, ctx: Any) -> web.Response:
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    name, err = _req_str(body, "name")
    if err is not None:
        return err

    icon, err = _opt_str(body, "icon")
    if err is not None:
        return err

    store = await _get_store(ctx)
    group_id = await asyncio.to_thread(store.add_group, name, icon=icon or "")
    return web.json_response({"id": group_id}, status=201)


async def _handle_delete_group(request: web.Request, ctx: Any) -> web.Response:
    group_id = request.match_info["id"]
    store = await _get_store(ctx)
    await asyncio.to_thread(store.delete_group, group_id)
    return web.json_response({"id": group_id, "deleted": True})


# ── History ──


async def _handle_list_history(request: web.Request, ctx: Any) -> web.Response:
    # ``?limit=abc`` must be a 400, not an uncaught ValueError -> 500.
    raw_limit = request.query.get("limit", "20")
    try:
        limit = int(raw_limit)
    except ValueError:
        return _bad_request("limit must be an integer", "invalid_field_type")
    if not 1 <= limit <= 500:
        return _bad_request("limit must be between 1 and 500", "invalid_field_type")

    store = await _get_store(ctx)
    history = await asyncio.to_thread(store.list_history, limit=limit)
    return web.json_response({"sessions": history})


async def _handle_add_history(request: web.Request, ctx: Any) -> web.Response:
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    problem, err = _req_str(body, "problem")
    if err is not None:
        return err

    advice, err = _opt_str(body, "advice")
    if err is not None:
        return err

    products = body.get("products", [])
    if not isinstance(products, list):
        return _bad_request("products must be an array", "invalid_field_type")
    if not all(isinstance(item, dict) for item in products):
        return _bad_request("products must contain only objects", "invalid_field_type")
    err = _check_records(products, "products", _PRODUCT_SPEC, required=("name",))
    if err is not None:
        return err

    store = await _get_store(ctx)
    entry_id = await asyncio.to_thread(
        store.add_history, problem, advice=advice or "", products=products
    )
    return web.json_response({"id": entry_id}, status=201)


async def _handle_update_feedback(request: web.Request, ctx: Any) -> web.Response:
    history_id = request.match_info["id"]
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    product_name, err = _req_str(body, "product")
    if err is not None:
        return err

    feedback, err = _req_str(body, "feedback")
    if err is not None:
        return err

    # Only the three states the UI can render; anything else would persist a
    # value that displays as a raw string in every locale.
    if feedback not in ("liked", "purchased", "skipped"):
        return _bad_request("feedback must be liked, purchased or skipped", "invalid_field_type")

    store = await _get_store(ctx)
    await asyncio.to_thread(store.update_feedback, history_id, product_name, feedback)
    return web.json_response({"id": history_id, "updated": True})


# ── Sites ──


def _sites_path(ctx: Any) -> Path:
    """The sites file inside the app's data directory (``ctx.data_dir``).

    Same file the built-in wrote through ``app_data_dir``, so an existing
    ``sites.json`` is read unchanged.
    """
    return Path(ctx.data_dir) / "sites.json"


async def _handle_get_sites(request: web.Request, ctx: Any) -> web.Response:
    def _read():
        return read_json_or(
            _sites_path(ctx), {"sites": []}, logger=logger, what="personal shopper sites"
        )

    data = await asyncio.to_thread(_read)
    return web.json_response(data)


async def _handle_put_sites(request: web.Request, ctx: Any) -> web.Response:
    body, err = await _json_object(request)
    if err is not None:
        return err
    assert body is not None

    sites = body.get("sites")
    if not isinstance(sites, list):
        return _bad_request("sites must be an array", "invalid_field_type")
    if not all(isinstance(item, dict) for item in sites):
        return _bad_request("sites must contain only objects", "invalid_field_type")
    err = _check_records(sites, "sites", _SITE_SPEC, required=("id", "name", "url"))
    if err is not None:
        return err

    def _write():
        path = _sites_path(ctx)
        mkdirs_owner_only(path.parent)
        # Atomic temp-file + rename. A plain write_text truncates the existing
        # file before the new bytes land, so an interruption mid-save leaves an
        # empty or partial file and the next read raises -- the user's whole store
        # configuration is gone rather than merely un-updated.
        atomic_write(path, json.dumps(body, indent=2, ensure_ascii=False), fsync=True)

    await asyncio.to_thread(_write)
    return web.json_response({"updated": True})


# ── Registration ──


async def on_shutdown(ctx: Any) -> None:
    """Release the store singleton's sqlite handles when the app is torn down.

    Declared as the manifest's ``backend.hooks.on_shutdown``: the gateway calls
    it on disable, uninstall and gateway shutdown. The built-in hung the same
    close on the gateway Application's ``on_cleanup``, which only fires at
    gateway exit.

    The connection runs in WAL mode, so leaving it open pins ``preferences.db``
    plus its ``-wal`` and ``-shm`` siblings. POSIX tolerates that, but Windows
    refuses to delete or rename a file that is still open, so disabling,
    uninstalling or resetting the app afterwards would fail with a
    ``PermissionError`` on files nothing was using any more.

    The singleton is cleared before the blocking close so a request arriving
    mid-shutdown rebuilds a fresh store instead of reusing a closed connection.
    """
    global _store
    with _store_lock:
        store, _store = _store, None
    if store is not None:
        await asyncio.to_thread(store.close)


def register_routes(ctx: Any) -> list[Any]:
    """The manifest's ``backend.hooks.routes``: this app's routes, unprefixed."""
    route = _host.app_route
    return [
        # Preferences
        route("GET", "/preferences", _handle_list_preferences),
        route("POST", "/preferences", _owner_only("add_preference", _handle_add_preference)),
        route(
            "PUT",
            "/preferences/{id}",
            _owner_only("update_preference", _handle_update_preference),
        ),
        route(
            "DELETE",
            "/preferences/{id}",
            _owner_only("delete_preference", _handle_delete_preference),
        ),
        route("POST", "/preferences/search", _handle_search_preferences),
        route(
            "POST",
            "/preferences/reembed",
            _owner_only("reembed_preferences", _handle_reembed_preferences),
        ),
        # Groups
        route("GET", "/groups", _handle_list_groups),
        route("POST", "/groups", _owner_only("add_group", _handle_add_group)),
        route("DELETE", "/groups/{id}", _owner_only("delete_group", _handle_delete_group)),
        # History
        route("GET", "/history", _handle_list_history),
        route("POST", "/history", _owner_only("add_history", _handle_add_history)),
        route(
            "PUT",
            "/history/{id}/feedback",
            _owner_only("update_feedback", _handle_update_feedback),
        ),
        # Sites
        route("GET", "/sites", _handle_get_sites),
        route("PUT", "/sites", _owner_only("put_sites", _handle_put_sites)),
    ]
