# Personal Shopper for Kiro Crew

A personal advisor that researches real stores and helps solve problems that may
or may not end in a purchase. It never buys anything: the advisor has no browser,
no shell and no way to delegate to an agent that has them, so every
recommendation ends with a link the user follows themselves.

This repository is the first-party, externally packaged form of the
`personal-shopper` app that ships built into Kiro Crew. The two share a name and
a version, so a later Kiro Crew release can adopt an existing built-in install
onto this source one-to-one. Until that adoption release, Kiro Crew keeps
shipping its built-in copy, and nothing here changes what an existing user runs.
[PORTING.md](PORTING.md) lists every place this copy differs from the built-in,
and why.

## What is in it

| Path | What it is |
|---|---|
| `app.json` | The app manifest (App Kit `manifest-reference.md`) |
| `agents/advisor.json` | The `personal-shopper-advisor` agent: `web_search` and `web_fetch` only |
| `skills/personal-shopper/` | The advisor's skill |
| `backend/routes.py` | In-gateway route hooks (`backend.hooks.routes` / `on_shutdown`) |
| `backend/store.py` | The preference store: sqlite, vector search with a keyword fallback |
| `backend/_host.py` | The only module that reaches into the Kiro Crew gateway |
| `backend/_fs.py` | Local stand-ins for the file helpers the built-in imported |
| `assets/` | Store icon, hero art and screenshot (raster, as the catalog requires) |
| `ui-src/` | The dashboard page's source, copied from Kiro Crew; **not built or served** (see PORTING.md) |
| `tests/` | Backend tests, runnable offline with pytest |

## Install

Once it is listed in the official catalog, install it from the Kiro Crew App
Store. The backend is in-gateway Python, which Kiro Crew runs for a non-built-in
app only after the operator turns on Settings → Security → Third-party apps.

The routes are served under `/api/apps/personal-shopper/` while the app is
enabled. Data lives in the app's own data directory,
`~/.kiro/crew/apps/personal-shopper/data/` (`preferences.db`, `sites.json`):
the same files the built-in uses.

## Develop

```bash
python -m pip install -r tests/requirements.txt
python -m pytest
```

The tests need neither Kiro Crew nor the network. Without Kiro Crew installed,
`backend/_host.py` falls back to local stand-ins that are never more permissive
than the gateway (the owner gate refuses every dashboard write when no owner is
configured). Test dependencies live in `tests/requirements.txt` on purpose: a
`requirements.txt` at the repository root would make a registry install run pip
into the gateway's interpreter.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
