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
  same; `tests/test_manifest_contract.py` compares them with the built-in's
  manifest (`tests/fixtures/builtin-app.json`), because adoption refuses a
  manifest that would widen a grant or force the app off.
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
| `register_routes(app: web.Application)` adding to `app.router` (`backend/routes.py:571-615`) | `register_routes(ctx) -> list[Route]`, handlers `(request, ctx)` | The `hooks.routes` contract. `Route` is the app's own frozen dataclass (`backend/_host.py`), which `RouteRegistry` accepts structurally from App Kit level 1. Paths are now relative (`/preferences`); the registry serves them under `/api/apps/personal-shopper/`. |
| `_require_enabled` gate on every route (`backend/routes.py:173`) | Removed | `RouteRegistry` deregisters an app's routes on disable (`apps/hooks_integration.py`, `deregister_app_routes`), so a disabled app answers 404 with no check in the app. The `app_disabled` 403 code is gone; the built-in UI never branched on it. |
| `app.on_cleanup.append(_close_store)` (`backend/routes.py:615`) | `backend.hooks.on_shutdown` → `on_shutdown(ctx)` | Runs on disable and uninstall too, not only at gateway exit, which is what lets Windows remove the data directory after a disable. |
| `LoopBoundLock` around store construction (`backend/routes.py:44`, `:55`) | A `threading.Lock` taken inside the `to_thread` worker | `kiro_crew.loop_lock` is private. Taking a thread lock inside the worker thread needs no loop binding at all. |
| `PreferenceStore(db_path=None)` defaulting to `app_data_dir(...)` (`backend/store.py:63`) | `PreferenceStore(db_path, *, embedder=None)` with `db_path_in(ctx.data_dir)` and `embedder=ctx.embed` | An external app has no ambient data home, only `ctx.data_dir`, and no import of the host's embedder, only `ctx.embed`. The store is rebuilt if a context names a different directory. |
| `from kiro_crew.apps.builtins.personal_shopper.backend.store import PreferenceStore` (`backend/routes.py:39`) | `from .store import ...` | Hook files load into a synthetic package; relative imports are the documented form (App Kit `manifest-reference.md`, "Importing your own modules"). |
| Package `__init__.py` re-exporting `register_routes` | Removed | Only the built-in boot loop reads it. |
| `iconUrl` / `heroImage*` as absolute `/app-assets/...` SVGs (`app.json:29-31`) | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source (`KiroCrewApps/tools/publish.py`, `ICON_EXT_ALLOWED`, `ART_EXT_ALLOWED`). The PNGs were rendered from the built-in SVGs: the icon on an opaque tile (512×512) with the theme tokens resolved to fixed colours, the heroes at 1200×675. The original SVGs are kept beside them. |
| `ui.pages` `[{"route": "/personal-shopper", "icon": "ShoppingBag"}]`, page compiled into the dashboard (`app.json:45`, `website/src/apps/builtinRegistry.ts:70`) | `ui.entry: "dist/index.mjs"` (a committed ESM bundle built from `ui/src/`), `ui.pages` `[{"route": "/apps/personal-shopper"}]`, no `icon` | An installed app ships its page as a bundle AppHost loads. The legacy `/personal-shopper` route, nav id and `ShoppingBag` glyph of an ADOPTED record come from Kiro Crew's adoption pin (`legacyNav`), never from this manifest, so a fresh install cannot claim them. |
| App Store copy keys in the dashboard catalogs (`website/src/components/appstore/appManifest.ts:334`) | `l10n` block in `app.json`, one entry per shipped non-English locale | The listing copy travels with the app. It is the `manifest` subtree of `ui/i18n/<locale>.json`, kept equal by a test. |
| No `minKiroCrewVersion` | `"minKiroCrewVersion": "0.12.0"` | The first Kiro Crew with App Kit level 1. An older one refuses a fresh install instead of serving the reduced form below. |

## Private Kiro Crew imports: replaced by App Kit level 1

Nothing in `backend/` imports `kiro_crew` (`tests/test_no_host_imports.py`).
Every gateway touch is in `backend/_host.py`, reads the seam off the hook
context with `getattr`, and has a fallback for a gateway without it that is
never more permissive than the host.

| Built-in import | Where | Now | Without the seam |
|---|---|---|---|
| `kiro_crew.apps.route_registry.AppRoute` | (required by `hooks.routes`) | `_host.Route`, a local frozen dataclass; `RouteRegistry` accepts any record with a str `method`, a str `path` and a callable `handler` | A registry that type-checks against its own class skips the routes (see "Older hosts") |
| `kiro_crew.dashboard.handlers._shared.require_owner_dashboard_request` | `backend/routes.py:42`, `:201` | `ctx.require_owner(request, operation)`, the same host gate; it audits a denial as `personal-shopper.<operation>` (the built-in wrote `personal_shopper.<operation>`) | Every caller is refused, the owner included (fail closed) |
| `kiro_crew.executors.run_in_embed_pool` | `backend/routes.py:43`, `:293`, `:317`, `:351`, `:384` | `ctx.embed.run(func, ...)`, the host's bounded embed pool | `asyncio.to_thread` |
| `kiro_crew.embeddings.get_shared_embedder` | `backend/store.py:40` | `ctx.embed`, passed to the store; `available()` and `embed_sync()` | No embedder: the store ranks by keyword, a path it already supports |
| `kiro_crew.apps.manager.app_data_dir` | `backend/store.py:27`, `backend/routes.py:40`, `:510` | `ctx.data_dir` | (public on every host) |
| `kiro_crew.apps.manager.is_app_enabled` | `backend/routes.py:40` | Dropped (see `_require_enabled` above) | |

### Older hosts

On a gateway below App Kit level 1 (`ctx.sdk_level` absent or 0)
`register_routes` still returns the routes and reports degraded health, naming
the missing seams. Reads work, writes are refused with `owner_only`, and search
is keyword-only. A registry that predates structural routes skips the records
with a warning, so the API answers 404. `minKiroCrewVersion` keeps a fresh
install off such a gateway; the case that remains is a Kiro Crew downgraded after
adoption, where the built-in copy's own routes serve the same paths (Kiro Crew
`app-kit-platform.md`, "Built-in adoption").

The page reads the level-1 SDK names (`fmtCurrency`, `Select`, `guideCaution`)
off namespace imports in `ui/src/hostSdk.ts`, each with a local fallback
(`fmtNumber` currency style, a native `<select>`, no caution marker), because a
named import of a missing export fails the whole bundle at load. Every name the
bundle imports by name exists on a pre-level-1 host; `tests/test_manifest_contract.py`
checks the built file. On a host without the chat-launch options the advisor
opens as a plain new chat with the agent selected, without the persistent-memory
and no-session-folder contract.

## Remaining gaps

1. **File helpers.** `kiro_crew.atomic_write` (`atomic_write`, `read_json_or`,
   `backend/routes.py:41`) and `kiro_crew.owner_only_files`
   (`mkdirs_owner_only`, `prepare_owner_only_sqlite`, `backend/store.py:28`) are
   re-stated in `backend/_fs.py`. The copy drops the host's Windows
   sharing-violation retries on rename and read, its once-per-path warning
   bound, its refusal to act through a symlinked directory inside the data home,
   and its hard-link publish of a new database file. A public file helper in the
   SDK would remove the copy.
2. **Execution trust.** A built-in's in-gateway Python is exempt from the
   third-party execution gate (`apps/execution.py:694-709`, `is_builtin_app`).
   This copy's hooks load only when the operator trusts it
   (`agent.apps_trusted`, or `agent.apps_allow_third_party`). For an existing
   user, Kiro Crew's adoption writes that grant for this repository in the same
   transaction that moves the record, so the routes keep loading; it never
   overwrites a grant to a different repository. A fresh install goes through
   the normal trust dialog.
3. **Styles.** The page keeps the built-in's Tailwind utility class strings. They
   render because the dashboard's stylesheet still carries them while the
   compiled built-in page ships with Kiro Crew. Removing that page from Kiro
   Crew needs the host to keep those utilities (or the bundle to carry its own
   CSS) first.
4. **Store listing localization.** The catalog's publish step does not carry
   `l10n` yet, so a store row that is not installed shows the English fields. An
   installed copy is localized from its own manifest.
5. **Sidebar icon on a fresh install.** The Lucide `ShoppingBag` glyph and the
   `/personal-shopper` route are shown only for an adopted record (from Kiro
   Crew's pin). A fresh install from the App Store lives at
   `/apps/personal-shopper` with the `iconPath` image.
6. **Themeable icon.** Built-in SVG icons are painted from `--ico-a` / `--ico-b`
   so one file covers both themes. The raster `assets/icon.png` uses fixed
   colours on an opaque tile; there is no `iconPathDark`, which is optional
   because the tile is opaque.
7. **Author.** `app.json` keeps `"author": "kirocrew"`, the built-in's value.
   The catalog's publish step refuses a manifest-asserted reserved author
   (`KiroCrewApps/tools/publish.py`, `RESERVED_AUTHORS`), so attribution is
   stated on the catalog row.

## UI

The page is `ui/src/`, ported from `website/src/apps/personal-shopper/` with the
same markup, class strings and behaviour. `npm run build` in `ui/` writes the
committed `ui/dist/index.mjs`; CI rebuilds it and fails on a difference.

| Built-in | Here |
|---|---|
| `useAppDispatch` + `createSlot({agent, memory_mode: 'persistent', sessionFolder: false})`, then `navigate('/chat')` (`PersonalShopperPage.tsx:18-19`, `:47`) | `useChatLauncher().openChat({agent: 'personal-shopper-advisor', memoryMode: 'persistent', sessionFolder: false})` |
| `utils/thunkError.errMessage` | Gone with `createSlot`; a throw from the launcher is shown with the same localized message |
| `components/ui` (`Btn`, `EmptyState`, `Input`, `PageHeader`), `SegmentedControl`, `ErrorNotice`, `hooks/useImeGuard` | The same components from `@kirocrew/app-sdk/ui`, `useImeGuard` from `@kirocrew/app-sdk` |
| `components/SimpleSelect` | `Select` from `@kirocrew/app-sdk/ui` (a native `<select>` on an older host) |
| `guide/trustRoot.guideCaution` | `guideCaution` from `@kirocrew/app-sdk/ui` |
| `i18n/format.fmtCurrency` | `fmtCurrency` from `@kirocrew/app-sdk` (`fmtNumber` on an older host) |
| `i18n/t.i18nT` with keys in the dashboard's catalogs | `t()` in `ui/src/i18n.ts` over the app's own catalogs, `ui/i18n/<locale>.json` for all 12 dashboard locales: the `apps.personalShopper.*` subtree copied from Kiro Crew, plus `components.errorBoundary.something_went_wrong` as `common.something_went_wrong`. Exact locale, then base language, then English |
| `api.ts` calling `fetch('/api/apps/personal-shopper/...')` | `useShopApi()` over `useAppApi()`, scoped to `permissions.api`; a refusal still surfaces as the backend's `code` |

## Tests

| Built-in test | Here | Change |
|---|---|---|
| `tests/test_routes.py` | `tests/test_routes.py` | Fixture serves `register_routes(ctx)` the way `RouteRegistry` dispatches it (`tests/harness.py`). Isolation is `ctx.data_dir`, with no patching. `TestDisabledAppIsRefused` became `TestRouteTableMatchesTheBuiltin`, which pins the 14 method/path pairs and that registering creates no files. |
| `tests/test_store.py` | `tests/test_store.py` | `TestDataHomeIsResolvedLazily` became `TestTheStoreLivesInTheAppDataDir`. `TestManifestWiring` now checks the external contract: hooks resolve to callables, art is repo-relative PNG, name and version match the built-in, and no root build file exists. The `BUILTIN_NAMES` and package re-export cases were dropped (built-in-only). |
| `tests/test_update_preserves_tags.py` | same | Unchanged. |
| `tests/test_platform_windows.py` | same | Exercises `on_shutdown(ctx)` instead of `on_cleanup`, and adds a rebuild-after-shutdown case. |
| `test/test_personal_shopper_owner_gate.py` | `tests/test_owner_gate.py` | `unittest` with `subTest` instead of `pytest.mark.parametrize` plus asyncio, so no pytest-asyncio is needed. The gate is `FakeCtx.require_owner` (the host predicate minus its implicit local subjects). Adds: no owner configured refuses everyone; the host's refusal (a 401) is returned unchanged; each write passes its bare operation name; reads and app tokens never ask; a context without the seam refuses every write. |
| `test/test_personal_shopper_no_purchase_capability.py` | `tests/test_no_purchase_capability.py` | Dropped the case that read `mochi`'s agent spec (not in this repository). Added a no-MCP-server case. |
| `test/test_personal_shopper_store_embedding.py` | `tests/test_store_embedding.py` | The store now asks only `available()`; the "unloaded but loadable on demand counts" case moved to the host's SDK and is pinned by Kiro Crew's `test/test_embed_sdk.py`. Here: no embed when unavailable, no SDK means keyword search, a None vector stores none. |
| `test/test_embed_offload_guards.py` (personal-shopper cases) | `tests/test_embed_offload_guards.py` | Asserts `_host.run_embed` instead of `run_in_embed_pool`. `tests/test_routes.py` (`TestEmbedWorkUsesTheHostPool`) checks the same by running the routes. |
| `website/src/test/personalShopperRowTags.test.ts`, `PreferencesTabCoverage.test.tsx` | `ui/tests/` | Run by vitest with stand-ins for the host SDK (`ui/tests/stubs/`). The dropdown cases drive a native `<select>`; one case checks the host's `Select` and caution marker are used. |
| (none) | `tests/test_no_host_imports.py`, `tests/test_manifest_contract.py` | No `kiro_crew` import in `backend/`. The bundle's imports, `minKiroCrewVersion`, permission parity with the built-in, the `l10n` block, and a tree adoption can take (no links, no unportable names, no root build file). |
| (none) | `ui/tests/advisorLaunch.test.tsx`, `i18n.test.ts`, `hostSdkLevel0.test.tsx`, `hostSdkLevel1.test.tsx`, `api.test.ts` | The launch options, the locale fallback and catalog coverage, the older-host fallbacks, and the scoped client's error codes. |

## What Kiro Crew keeps doing

The release that adds adoption still ships the built-in. A user's built-in
record moves onto this repository at the commit Kiro Crew pins, on the restart
after the tree is fetched and verified; a record that cannot move (offline, or
refused by the operator's admission policy) keeps running the built-in copy,
unchanged. The KiroCrewApps catalog row switches from `builtin` to `git` at that
same commit in the same release. Removing the built-in from Kiro Crew is a later
release, after the remaining gaps above that it depends on (styles, and the
file helpers if the host wants the copy gone) are closed.

## Release handoff: one commit for both pins

The adoption pin and the catalog row must name the same commit, and that commit
must be the ported tree, not `4933502` (the first commit, which is what
`origin/main` holds and which still carries the built-in's `backend.routes`
shape).

1. Commit and push the port here. Call that full 40-hex SHA `C`
   (`git rev-parse HEAD`).
2. In the Kiro Crew release PR that adds adoption, run
   `python3 scripts/adoption_pin.py compute <this URL> C` and add the row it
   prints (commit, `treeSha256`, `archiveSha256`, `legacyNav`) to
   `src/kiro_crew/apps/adoption-pins.json`; then
   `python3 scripts/adoption_pin.py verify`. Until that row exists the release
   adopts nothing, and the catalog row must not switch.
3. The KiroCrewApps row for `personal-shopper` switches to
   `"type": "git"`, this URL, `"ref": "C"`. Never a branch name or a
   placeholder: a branch moves after the release, and the catalog validator
   reads any string as a branch.
4. Check that both files name the same `C`, and that GitHub serves it: in a
   fresh clone, `git fetch origin C` succeeds and `git cat-file -t C` prints
   `commit`.
5. The catalog PR stays a draft, labelled hold-for-release, until the Kiro Crew
   release that ships adoption and the App Kit level-1 seams is published.
