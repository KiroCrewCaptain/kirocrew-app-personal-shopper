"""Serve ``register_routes(ctx)`` the way the gateway's RouteRegistry does.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches the
remainder against each route record, injects path params into ``match_info``,
and calls ``handler(request, ctx)``. aiohttp's own router does the matching here,
under the same prefix, so a test request uses the URL a dashboard request uses.

``FakeCtx`` stands in for the gateway's ``AppContext`` at App Kit level 1, with
only the fields this app reads. Nothing here imports Kiro Crew and nothing opens
a socket beyond aiohttp's loopback test server.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from aiohttp import web

from backend import routes as routes_mod

PREFIX = "/api/apps/personal-shopper"


class FakeEmbed:
    """The host's embed SDK (``ctx.embed``), deterministic and offline.

    ``vectors`` maps a text to its vector; any other text gets a hash-derived unit
    vector, so equal texts embed equally and different texts almost never
    collide. ``ready=False`` is a host with no model to serve. ``run`` records
    every call it offloads, which is how a test sees that embed work went to the
    host's pool rather than the default executor.
    """

    def __init__(
        self, vectors: dict[str, list[float]] | None = None, *, ready: bool = True, dim: int = 8
    ) -> None:
        self.vectors = dict(vectors or {})
        self.ready = ready
        self.dim = dim
        self.embedded: list[str] = []
        self.offloaded: list[str] = []

    def available(self) -> bool:
        return self.ready

    @property
    def model_id(self) -> str:
        return "fake-hash-embedder" if self.ready else ""

    def embed_sync(self, text: str) -> list[float] | None:
        if not self.ready:
            return None
        self.embedded.append(text)
        if text in self.vectors:
            return list(self.vectors[text])
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        raw = [b - 127.5 for b in digest[: self.dim]]
        norm = math.sqrt(sum(x * x for x in raw)) or 1.0
        return [x / norm for x in raw]

    async def run(self, func: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Any:
        self.offloaded.append(getattr(func, "__name__", repr(func)))
        return await asyncio.to_thread(functools.partial(func, *args, **kwargs))


class FakeHealth:
    def __init__(self) -> None:
        self.status = "healthy"
        self.issues: list[str] = []

    def mark_degraded(self, issue: str) -> None:
        self.status = "degraded"
        self.issues.append(issue)


def _owner_only_response() -> web.Response:
    return web.json_response(
        {"error": "owner authorization required", "code": "owner_only"}, status=403
    )


@dataclass
class FakeCtx:
    """The ``AppContext`` fields this app reads, at App Kit level 1.

    ``require_owner`` mirrors the host predicate (``is_owner_dashboard_request``)
    minus its implicit local subjects: ``None`` only for a dashboard request
    (``app`` claim present and ``""``) whose subject is the configured owner
    (``app["state"].owner_id``, as on the gateway); otherwise the refusal
    response, which the app must return unchanged. Every call is recorded with
    its bare operation name.
    """

    name: str
    data_dir: Path
    embed: FakeEmbed | None = None
    sdk_level: int = 1
    health: FakeHealth = field(default_factory=FakeHealth)
    owner_checks: list[str] = field(default_factory=list)
    refusal: Callable[[], web.StreamResponse] = _owner_only_response

    async def require_owner(self, request: web.Request, operation: str) -> Any | None:
        self.owner_checks.append(operation)
        state = request.app.get("state")
        owner_id = str(getattr(state, "owner_id", "") or "")
        caller = str(request.get("user") or "")
        dashboard = "app" in request and request["app"] == ""
        if dashboard and owner_id and caller == owner_id:
            return None
        return self.refusal()


class LegacyCtx:
    """A context from a gateway that predates App Kit level 1: no seams at all."""

    def __init__(self, data_dir: Path) -> None:
        self.name = "personal-shopper"
        self.data_dir = Path(data_dir)
        self.health = FakeHealth()


def make_ctx(data_dir: Path, *, embed: FakeEmbed | None = None) -> FakeCtx:
    """A level-1 context. No embedder unless one is passed: keyword search."""
    return FakeCtx(name="personal-shopper", data_dir=Path(data_dir), embed=embed)


def build_app(
    ctx: Any, *, middlewares: list[Any] | None = None, owner_id: str = ""
) -> web.Application:
    app = web.Application(middlewares=middlewares or [])
    app["state"] = _State(owner_id)
    for route in routes_mod.register_routes(ctx):

        async def _dispatch(request: web.Request, _route: Any = route) -> web.StreamResponse:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)
    return app


@dataclass
class _State:
    owner_id: str


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
