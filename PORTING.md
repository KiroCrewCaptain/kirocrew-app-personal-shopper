# Porting notes: built-in → external app

This repository was ported from Kiro Crew's built-in app at
`src/kiro_crew/apps/builtins/personal_shopper/` (KiroCrew `main` at `a1704d5c10`),
its dashboard page at `website/src/apps/personal-shopper/`, its store art at
`website/public/app-assets/personal-shopper/`, and its tests (the four under the
app's own `tests/`, plus `test/test_personal_shopper_owner_gate.py`,
`test/test_personal_shopper_no_purchase_capability.py`,
`test/test_personal_shopper_store_embedding.py` and the personal-shopper cases of
`test/test_embed_offload_guards.py`).

Line numbers below refer to that commit. "Gap" means something the built-in
gets from Kiro Crew that an external app has no public way to get today. Each gap
is a Kiro Crew change, not a change here.

## What carried over unchanged

- `app.json` `name` (`personal-shopper`) and `version` (`0.1.0`), so adoption can
  map an existing built-in record onto this source one to one. `defaultEnabled`,
  `permissions`, `platform`, `agents`, `skills` and every display field are the
  same.
- `agents/advisor.json` and `skills/personal-shopper/SKILL.md`, byte for byte.
  The materialized names (`personal-shopper-advisor`, skill `personal-shopper`)
  are therefore the same as the built-in's.
- Every route's path, method, validation and response shape. The validation
  helpers (`_bad_request` through `_SITE_SPEC`) and the handler bodies are copied
  verbatim apart from the signature change below.
- `backend/store.py`'s logic, including dedup, FTS sync and vector staleness.
- The data location: the gateway hands an app's hooks
  `ctx.data_dir = <data home>/apps/personal-shopper/data`
  (`apps/hooks_integration.py` `_build_app_context_from_info`), which is the
  directory the built-in resolved through `app_data_dir` (`apps/manager_records.py:61`).
  `preferences.db` and `sites.json` keep their names, so a user's existing data
  is read as is.

## What changed, and why

| Built-in | Here | Why |
|---|---|---|
| `"backend": {"routes": "backend.routes:register_routes"}` (`app.json:56`) | `"backend": {"hooks": {"routes": ..., "on_shutdown": ...}}` | Top-level `backend.routes` is read only by the built-in boot loop (`dashboard/routes/system.py`, the `BUILTIN_NAMES` loop). An external app's routes go through `RouteRegistry` (`apps/route_registry.py`). |
| `register_routes(app: web.Application)` adding to `app.router` (`backend/routes.py:571-615`) | `register_routes(ctx) -> list[AppRoute]`, handlers `(request, ctx)` | The `hooks.routes` contract (`apps/route_registry.py:28`, `:143`). Paths are now relative (`/preferences`); the registry serves them under `/api/apps/personal-shopper/`. |
| `_require_enabled` gate on every route (`backend/routes.py:173`) | Removed | `RouteRegistry` deregisters an app's routes on disable (`apps/hooks_integration.py`, `deregister_app_routes`), so a disabled app answers 404 with no check in the app. The `app_disabled` 403 code is gone; the built-in UI never branched on it. |
| `app.on_cleanup.append(_close_store)` (`backend/routes.py:615`) | `backend.hooks.on_shutdown` → `on_shutdown(ctx)` | Runs on disable and uninstall too, not only at gateway exit, which is what lets Windows remove the data directory after a disable. |
| `LoopBoundLock` around store construction (`backend/routes.py:44`, `:55`) | A `threading.Lock` taken inside the `to_thread` worker | `kiro_crew.loop_lock` is private. Taking a thread lock inside the worker thread needs no loop binding at all. |
| `PreferenceStore(db_path=None)` defaulting to `app_data_dir(...)` (`backend/store.py:63`) | `db_path` required; `db_path_in(ctx.data_dir)` | An external app has no ambient data home, only `ctx.data_dir`. The store is rebuilt if a context names a different directory. |
| `from kiro_crew.apps.builtins.personal_shopper.backend.store import PreferenceStore` (`backend/routes.py:39`) | `from .store import ...` | Hook files load into a synthetic package; relative imports are the documented form (App Kit `manifest-reference.md`, "Importing your own modules"). |
| Package `__init__.py` re-exporting `register_routes` | Removed | Only the built-in boot loop reads it. |
| `iconUrl` / `heroImage*` as absolute `/app-assets/...` SVGs (`app.json:29-31`) | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source (`KiroCrewApps/tools/publish.py`, `ICON_EXT_ALLOWED`, `ART_EXT_ALLOWED`). The PNGs were rendered from the built-in SVGs: the icon on an opaque tile (512×512) with the theme tokens resolved to fixed colours, the heroes at 1200×675. The original SVGs are kept beside them. |
| `ui.pages` with Lucide `"icon": "ShoppingBag"` (`app.json:45`) | No `ui` block | See "UI" below. |

## Gaps: private Kiro Crew imports

Every one is isolated in `backend/_host.py` (or replaced in `backend/_fs.py`).
Each `_host.py` import is lazy, and its fallback is never more permissive than
the host.

| Built-in import | Where | Status here | Gap to close in Kiro Crew |
|---|---|---|---|
| `kiro_crew.apps.route_registry.AppRoute` | (new; required by `hooks.routes`) | Imported from the host inside a gateway, because `RouteRegistry` type-checks against its own class (`route_registry.py`, `isinstance(route, AppRoute)`). A local dataclass of the same shape otherwise. | No public SDK module exports `AppRoute`, yet the documented `hooks.routes` contract requires returning it. Export it from a public, versioned path, or accept any object with `method` / `path` / `handler`. |
| `kiro_crew.dashboard.handlers._shared.require_owner_dashboard_request` | `backend/routes.py:42`, `:201` | Host gate inside a gateway. The fallback admits only `request["user"] == state.owner_id` with `app == ""`, and refuses everyone when no owner is configured (the host also accepts its implicit local subjects, `dashboard/handlers/source_providers.py:805`). | No public owner-gate seam for app routes. Needs an SDK call (for example `ctx.require_owner(request, op)`) or `signedPrincipal`-style principal data on in-gateway requests. |
| `kiro_crew.executors.run_in_embed_pool` | `backend/routes.py:43`, `:293`, `:317`, `:351`, `:384` | Host pool inside a gateway, `asyncio.to_thread` otherwise. | No public embed-pool seam, and without it embed work lands on the shared default executor. |
| `kiro_crew.embeddings.get_shared_embedder` | `backend/store.py:40` | Unchanged, still guarded by `ImportError`. Without it the store runs on keyword search, a path it already supports. | No public embedder seam (`ctx.embed` or similar). Until there is one, semantic dedup and search depend on a private name. |
| `kiro_crew.apps.manager.app_data_dir` | `backend/store.py:27`, `backend/routes.py:40`, `:510` | Replaced by `ctx.data_dir` (public). | None. |
| `kiro_crew.apps.manager.is_app_enabled` | `backend/routes.py:40` | Dropped (see `_require_enabled` above). | None. |
| `kiro_crew.atomic_write.atomic_write`, `read_json_or` | `backend/routes.py:41` | Re-stated in `backend/_fs.py` (temp file plus `os.replace`, fsync; tolerant JSON read). | Drops the host's Windows sharing-violation retries on rename and read, and the once-per-path warning bound. A public file helper in the SDK would remove the copy. |
| `kiro_crew.owner_only_files.mkdirs_owner_only`, `prepare_owner_only_sqlite` | `backend/store.py:28` | Re-stated in `backend/_fs.py` (0700 directories and a 0600 database created before `connect` on POSIX; no-op modes on Windows). | Drops the host's refusal to act through a symlinked directory inside the data home, and its hard-link publish of a new database file. |

## Gaps: built-in-only capabilities

1. **Execution trust.** A built-in's in-gateway Python is exempt from the
   third-party execution gate (`apps/execution.py:694-709`, `is_builtin_app`).
   This copy's hooks load only when the operator trusts third-party apps
   (`agent.apps_allow_third_party`) or grants this app by name
   (`trusted_app_names`), otherwise `module_loader.load_app_module` refuses them
   (`apps/module_loader.py:435-449`). Adoption needs either a grant written for
   the adopted record or a first-party provenance rule. Without one, an existing
   user's routes are refused after the switch.
2. **UI.** The built-in page is compiled into the dashboard bundle and routed
   by `website/src/apps/builtinRegistry.ts:70`. An external app must ship a
   committed ESM bundle as `ui.entry` (`ui/dist/*.mjs`) that imports only
   `@kirocrew/app-sdk` / `@kirocrew/app-sdk/ui` and its own code. No such bundle
   exists yet, so this manifest declares **no `ui` block**: declaring
   `ui.pages` with no entry would give a sidebar row that loads nothing. The
   source is copied under `ui-src/` (5 files, plus the 2 frontend test files
   and the 69 `apps.personalShopper.*` English strings in `ui-src/i18n/en.json`)
   so the port can start from it. No build was invented. What it needs:
   - `PersonalShopperPage.tsx:18-19`, `:47`: `useAppDispatch` plus
     `store/chatSlice.createSlot({agent, memory_mode: 'persistent', sessionFolder: false})`,
     then `navigate('/chat')`. The SDK's `openChat` / `createSlot(name, agent?)`
     do not document `memory_mode` or `sessionFolder`. **Gap**: no SDK way to
     start an app-agent session with persistent memory and no session folder.
   - `PreferencesTab.tsx:20`: `guide/trustRoot.guideCaution`. **Gap**: no SDK
     export.
   - `PreferencesTab.tsx:16`: `components/SimpleSelect`. Not in
     `@kirocrew/app-sdk/ui`. `SettingsSelect` is the nearest export; it is
     unverified whether it fits inline use.
   - `HistoryTab.tsx:17`: `i18n/format.fmtCurrency`. The SDK exports
     `fmtNumber` / `fmtDate` and others but not a currency formatter. **Gap**.
   - `utils/thunkError.errMessage` (`PersonalShopperPage.tsx:20`) exists only
     for Redux's serialized errors and goes away with `createSlot`.
   - `components/ui` (`Btn`, `EmptyState`, `Input`, `PageHeader`),
     `SegmentedControl`, `ErrorNotice` and `hooks/useImeGuard` have SDK
     equivalents (`@kirocrew/app-sdk/ui`, `useImeGuard`).
   - `i18n/t.i18nT` with keys in the dashboard's catalogs, translated into every
     dashboard locale (`website/src/i18n/locales/*.json`). Apps own their
     catalogs (App Kit `getting-started.md`, "Shared interaction and locale
     helpers"), so the bundle must carry its own strings for every locale. Only
     English is copied here.
   - `api.ts` calls `fetch('/api/apps/personal-shopper/...')` directly. In a
     bundle it should go through `useAppApi()`, which is scoped to
     `permissions.api`.
   - The App Store copy keys in `website/src/components/appstore/appManifest.ts:334`
     localize the built-in's listing. A registry app's listing shows the
     manifest's own English strings.
3. **Sidebar icon.** The Lucide `ShoppingBag` glyph (`app.json:45`) is
   built-in-only; an installed app's sidebar row shows a generic icon unless it
   ships `iconPath` (now set) or `ui.pages[].iconUrl`.
4. **Themeable icon.** Built-in SVG icons are painted from `--ico-a` / `--ico-b`
   so one file covers both themes. The raster `assets/icon.png` uses fixed
   colours on an opaque tile; there is no `iconPathDark`, which is optional
   because the tile is opaque.
5. **Author.** `app.json` keeps `"author": "kirocrew"`, the built-in's value.
   The catalog's publish step refuses a manifest-asserted reserved author
   (`KiroCrewApps/tools/publish.py`, `RESERVED_AUTHORS`), so attribution must be
   stated on the catalog row, as it already is for the built-in row.

## Tests

| Built-in test | Here | Change |
|---|---|---|
| `tests/test_routes.py` | `tests/test_routes.py` | Fixture serves `register_routes(ctx)` the way `RouteRegistry` dispatches it (`tests/harness.py`). Isolation is `ctx.data_dir`, with no patching. `TestDisabledAppIsRefused` became `TestRouteTableMatchesTheBuiltin`, which pins the 14 method/path pairs and that registering creates no files. |
| `tests/test_store.py` | `tests/test_store.py` | `TestDataHomeIsResolvedLazily` became `TestTheStoreLivesInTheAppDataDir`. `TestManifestWiring` now checks the external contract: hooks resolve to callables, art is repo-relative PNG, name and version match the built-in, and no root build file exists. The `BUILTIN_NAMES` and package re-export cases were dropped (built-in-only). |
| `tests/test_update_preserves_tags.py` | same | Unchanged. |
| `tests/test_platform_windows.py` | same | Exercises `on_shutdown(ctx)` instead of `on_cleanup`, and adds a rebuild-after-shutdown case. |
| `test/test_personal_shopper_owner_gate.py` | `tests/test_owner_gate.py` | `unittest` with `subTest` instead of `pytest.mark.parametrize` plus asyncio, so no pytest-asyncio is needed. Adds a fail-closed case (no owner configured) and a case pinning that the host's gate is used when importable. |
| `test/test_personal_shopper_no_purchase_capability.py` | `tests/test_no_purchase_capability.py` | Dropped the case that read `mochi`'s agent spec (not in this repository). Added a no-MCP-server case. |
| `test/test_personal_shopper_store_embedding.py` | `tests/test_store_embedding.py` | Import path only. |
| `test/test_embed_offload_guards.py` (personal-shopper cases) | `tests/test_embed_offload_guards.py` | Import path only. |
| `website/src/test/personalShopperRowTags.test.ts`, `PreferencesTabCoverage.test.tsx` | `ui-src/tests/` | Copied, not run: they need the dashboard's test setup. |

## What Kiro Crew keeps doing

Nothing in Kiro Crew changes with this repository. The built-in keeps shipping
and keeps its routes, page, tests and catalog row until an adoption release
switches existing records over.
