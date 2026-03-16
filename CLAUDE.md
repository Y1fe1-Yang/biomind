# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Browser / UI Automation

**MANDATORY: Always use Chrome DevTools Protocol (CDP) MCP for all browser operations.**

Never use Playwright, Puppeteer, or any other browser automation library. This applies to every task involving a browser — navigating pages, clicking, typing, screenshots, DOM inspection, JS execution, performance/accessibility audits.

Use the `chrome-devtools-mcp` skill and its associated MCP tools exclusively.

## Commands

**Run the dev server:**
```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080
```

**Run all tests:**
```bash
pytest
```

**Run a single test file or test:**
```bash
pytest tests/test_auth.py -v
pytest tests/test_auth.py::test_login_success -v
```

**Rebuild data index** (after adding PDFs to `1.Journal Articles/`, `2.Conference Proceedings/`, etc.):
```bash
python scripts/build.py             # incremental — appends new files only
python scripts/build.py --rebuild   # full rebuild, preserves existing notes/abstracts
```

**Rebuild Tailwind CSS** (after changing classes in HTML/JS):
```bash
node_modules/.bin/tailwindcss -i frontend/assets/input.css -o frontend/assets/style.css --minify
```

## Architecture

### Stack
FastAPI backend + Vanilla JS SPA + Tailwind CSS v3. No build step for JS. Deployed on Render free tier (Singapore).

### Data Loading — two patterns coexist
- **Script-tag globals** (`window.DATA`, `window.MEMBERS`): `data/data.js` and `data/members.js` are served as static files and loaded via `<script>` tags in `index.html`. These contain papers, SOPs, books, presentations, and member profiles. Never use `fetch()` for these.
- **API fetch** (`/api/news`): News articles are fetched asynchronously at runtime from `GET /api/news`, backed by `data/news.json`. News is NOT loaded via a script tag.

### Frontend SPA (frontend/assets/app.js)
Hash-based router — views: `#home`, `#papers`, `#sops`, `#news`, `#news/{id}`, `#members`, `#directions`, `#about`. The `renderView(name)` function dispatches to per-view render functions. `window.DATA` and `window.MEMBERS` are available globally after page load. `apiFetch()` wraps `fetch()` to inject JWT and handle 401. i18n via `window.I18N_ZH` / `window.I18N_EN` (loaded from `frontend/i18n/`).

### Auth
JWT HS256, 7-day expiry. `deps.py` exports `current_user` (any logged-in user) and `admin_required` (admin only) FastAPI dependencies. Registration requires an admin JWT — the login modal only shows the login tab; registration is invite-only via the API. First user auto-becomes admin. Credentials stored in `data/users.db` (SQLite, bcrypt).

### AI Chat Pipeline
`POST /api/chat` → BM25 RAG retrieves top-5 entries from `data/data.json` → context block prepended to user message → streamed to AI provider → SSE response. Conversations persisted as JSON in `conversations/{username}/{conv_id}.json`. RAG index is built once per process (module-level cache in `rag.py`).

### AI Providers (AI_PROVIDER env var)
| Value | When to use |
|---|---|
| `zhipu` | Production (Render) — GLM-4-Flash, free |
| `claude` | Raw Anthropic API — needs `CLAUDE_API_KEY` |
| `kimi` | Kimi/Moonshot API — needs `KIMI_API_KEY` |
| `claude-code` | Local only — **broken in nested CC sessions** |

### Data Pipeline (scripts/build.py)
Scans `1.Journal Articles/`, `2.Conference Proceedings/`, `3.Books/`, `files/sops/`, `files/presentations/` → generates `data/data.json` + `data/data.js`. AI-extracted metadata is cached in `data/meta_cache.json` and merged on rebuild. PDF thumbnails generated to `data/thumbs/{id}.png` via PyMuPDF (first page, 2× scale).

### Key File Locations
- `data/users.db` — SQLite user store (not in git)
- `data/data.json` + `data/data.js` — canonical knowledge index (in git)
- `data/news.json` — news articles (in git)
- `data/news-images/` — uploaded images served at `/data/news-images/`
- `data/thumbs/` — PDF thumbnails served at `/data/thumbs/`
- `conversations/` — per-user conversation JSON files (not in git)

### Windows-specific
Always use `encoding="utf-8"` on `Path.read_text()` / `write_text()` calls — Chinese filenames and content require explicit UTF-8 on Windows.

## Tests
74 tests across 8 files. All must pass before committing. Tests that touch the DB use `monkeypatch` to redirect `DB_PATH` to a `tmp_path`. Auth tests use `TestClient` as a context manager so the startup event fires (`ensure_admin_exists` seeds `admin`/`admin`).
