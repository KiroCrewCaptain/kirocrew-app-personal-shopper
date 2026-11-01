"""Every place this app reaches into the Kiro Crew gateway, in one module.

An external app's Python runs inside the gateway process, so ``kiro_crew`` is
importable at runtime, but only a few of its names are a contract an app may
rely on. This module holds the three the built-in needed that have no public
App SDK seam yet. Each one is imported lazily, so a test run without Kiro Crew
installed still works, and each has a fallback that is never MORE permissive
than the host. PORTING.md lists them as the gaps to close in Kiro Crew.

1. ``AppRoute``: the record type ``hooks.routes`` must return. The gateway's
   ``RouteRegistry`` checks ``isinstance(route, AppRoute)`` against its own
   class, so inside a gateway the real one must be used. Outside one, a local
   dataclass with the same three fields stands in.
2. The owner gate. The built-in called the dashboard's private
   ``require_owner_dashboard_request``. Inside a gateway that is still what
   runs. The fallback admits only a caller whose subject equals the configured
   ``owner_id``, and refuses everyone when no owner is configured.
3. The embedding bulkhead pool (``run_in_embed_pool``). The fallback is
   ``asyncio.to_thread``, which is what the default pool would do anyway.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from aiohttp import web

logger = logging.getLogger(__name__)


@dataclass
class _LocalAppRoute:
    """Same shape as ``kiro_crew.apps.route_registry.AppRoute``."""

    method: str
    path: str
    handler: Callable[[web.Request, Any], Awaitable[web.Response]]


def _app_route_class() -> type:
    try:
        from kiro_crew.apps.route_registry import AppRoute
    except ImportError:
        return _LocalAppRoute
    return AppRoute


def app_route(method: str, path: str, handler: Callable[..., Any]) -> Any:
    """Build one route record of the class the running host accepts."""
    return _app_route_class()(method, path, handler)


def _owner_denied() -> web.Response:
    return web.json_response(
        {"error": "owner authorization required", "code": "owner_only"}, status=403
    )


def _fallback_is_owner(request: web.Request) -> bool:
    """The host's owner predicate minus its implicit local subjects.

    The host also accepts two bootstrap subjects when no ``owner_id`` is set.
    This fallback does not, so outside a gateway it only ever refuses MORE.
    """
    state = request.app.get("state") if hasattr(request.app, "get") else None
    owner_id = str(getattr(state, "owner_id", "") or "")
    caller = str(request.get("user") or "")
    if "app" not in request or request["app"] != "" or not caller:
        return False
    return bool(owner_id) and caller == owner_id


async def require_owner(request: web.Request, operation: str) -> web.Response | None:
    """``None`` when the caller is the dashboard owner, else a 403 ``owner_only``."""
    try:
        from kiro_crew.dashboard.handlers._shared import (
            require_owner_dashboard_request,
        )
    except ImportError:
        return None if _fallback_is_owner(request) else _owner_denied()
    return await require_owner_dashboard_request(request, operation)


async def run_in_embed_pool(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Run embedding work on the host's bounded embed pool when there is one.

    ``store.add`` / ``search`` / ``update`` / ``reembed_all`` call a synchronous
    embedder that can block for a long time, so inside a gateway they must not
    occupy the shared default executor that every other offload uses.
    """
    try:
        from kiro_crew.executors import run_in_embed_pool as host_pool
    except ImportError:
        return await asyncio.to_thread(func, *args, **kwargs)
    return await host_pool(func, *args, **kwargs)
