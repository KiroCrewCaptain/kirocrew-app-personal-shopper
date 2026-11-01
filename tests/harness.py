"""Serve ``register_routes(ctx)`` the way the gateway's RouteRegistry does.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches the
remainder against each ``AppRoute``, injects path params into ``match_info``, and
calls ``handler(request, ctx)``. aiohttp's own router does the matching here,
under the same prefix, so a test request uses the URL a dashboard request uses.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from aiohttp import web

from backend import routes as routes_mod

PREFIX = "/api/apps/personal-shopper"


def make_ctx(data_dir: Path) -> SimpleNamespace:
    """The two AppContext fields this app reads."""
    return SimpleNamespace(name="personal-shopper", data_dir=Path(data_dir))


def build_app(
    ctx: Any, *, middlewares: list[Any] | None = None, owner_id: str = ""
) -> web.Application:
    app = web.Application(middlewares=middlewares or [])
    app["state"] = SimpleNamespace(owner_id=owner_id)
    for route in routes_mod.register_routes(ctx):

        async def _dispatch(request: web.Request, _route: Any = route) -> web.Response:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)
    return app


def identity(user: str, app_claim: Any) -> Any:
    """Middleware standing in for the token middleware's authenticated claims.

    ``app_claim`` of ``None`` leaves the ``app`` key absent entirely.
    """

    @web.middleware
    async def _identity(request: web.Request, handler: Any) -> web.StreamResponse:
        request["user"] = user
        if app_claim is not None:
            request["app"] = app_claim
        return await handler(request)

    return _identity
