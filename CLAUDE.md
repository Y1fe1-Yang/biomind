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

**Run with Docker** (self-hosted / local Docker deployment):
```bash
docker-compose up --build
```
Volumes in `docker-compose.yml` bind-mount `data/`, `conversations/`, `files/`, and the PDF directories so data persists outside the container.

## Architecture

### Stack
FastAPI backend + Vanilla JS SPA + Tailwind CSS v3. No build step for JS. Deployed on Render via Dockerfile + `render.yaml`.

### Data Loading — two patterns coexist
- **Script-tag globals** (`window.DATA`, `window.MEMBERS`): `data/data.js` and `data/members.js` are served as static files and loaded via `<script>` tags in `index.html`. These contain papers, system SOPs, books, presentations, and member profiles. Never use `fetch()` for these.
- **API fetch** (`/api/news`, `/api/sops`): News articles and user-uploaded SOPs/shares are fetched asynchronously at runtime. These are NOT loaded via a script tag.

### Frontend SPA (frontend/assets/app.js)
Hash-based router — views: `#home`, `#papers`, `#sops`, `#news`, `#news/{id}`, `#members`, `#directions`, `#timeline`, `#about`, `#presentations`. The `renderView(name)` function dispatches to per-view render functions. `window.DATA` and `window.MEMBERS` are available globally after page load. `apiFetch()` wraps `fetch()` to inject JWT and handle 401. i18n via `window.I18N_ZH` / `window.I18N_EN` (loaded from `frontend/i18n/`).

### Auth
JWT HS256, 7-day expiry. `deps.py` exports `current_user` (any logged-in user) and `admin_required` (admin only) FastAPI dependencies. Registration requires an admin JWT — the login modal only shows the login tab; registration is invite-only via the API. First user auto-becomes admin. Credentials stored in `data/users.db` (SQLite, bcrypt).

### AI Chat Pipeline
`POST /api/chat` → BM25 RAG retrieves top-5 entries from `data/data.json` → context block prepended to user message → streamed to AI provider → SSE response. Conversations persisted as JSON in `conversations/{username}/{conv_id}.json`. RAG index is built once per process (module-level cache in `rag.py`).

### AI Providers (AI_PROVIDER env var)
| Value | When to use |
|---|---|
| `zhipu` | Production — GLM-4-Flash, free |
| `claude` | Raw Anthropic API — needs `CLAUDE_API_KEY` |
| `kimi` | Kimi/Moonshot API — needs `KIMI_API_KEY` |
| `claude-code` | Local only — **broken in nested CC sessions** |

AI provider/keys can also be changed at runtime via the admin panel (`PUT /api/admin/ai-config`), which writes to `data/ai_config.json`. The config file takes precedence over env vars when present.

### Two SOP Systems
- **System SOPs** (`window.DATA.sops`): built from `files/sops/` by `scripts/build.py`; read-only from the frontend.
- **User-uploaded SOPs/shares** (`data/user-sops.json`): created via `POST /api/sops`; support file upload (PDF/DOCX ≤ 20 MB) or Markdown content. Physical files stored in `data/user-sops/{username}/`. Social counts (likes/bookmarks/comments) are mirrored here from SQLite for fast list reads.

### Social Features
Likes, bookmarks, and comments on user SOPs are stored in `data/users.db` alongside the users table, using three extra tables: `sop_likes`, `sop_bookmarks`, `sop_comments`. These are auto-created on startup via `_ensure_social_tables()` (called in `main.py`'s startup event alongside `ensure_admin_exists()`).

### Data Pipeline (scripts/build.py)
Scans `1.Journal Articles/`, `2.Conference Proceedings/`, `3.Books/`, `files/sops/`, `files/presentations/` → generates `data/data.json` + `data/data.js`. AI-extracted metadata is cached in `data/meta_cache.json` and merged on rebuild. PDF thumbnails generated to `data/thumbs/{id}.png` via PyMuPDF (first page, 2× scale).

### Key File Locations
- `data/users.db` — SQLite: users + sop_likes / sop_bookmarks / sop_comments tables (not in git)
- `data/data.json` + `data/data.js` — canonical knowledge index (in git)
- `data/news.json` — news articles, sorted newest-first (in git)
- `data/news-images/` — uploaded images served at `/data/news-images/`
- `data/thumbs/` — PDF thumbnails served at `/data/thumbs/`
- `data/members.js` — `window.MEMBERS`; groups: pi/postdoc/researcher/phd/master/alumni; `photos[]` array (in git)
- `data/user-sops.json` — user-uploaded SOPs/shares with social counts (in git)
- `data/user-sops/` — physical SOP files by username (not in git)
- `data/ai_config.json` — runtime AI provider/key config; overrides env vars when present (in git)
- `data/footer_config.json` — footer link config managed via admin panel (in git)
- `conversations/` — per-user conversation JSON files (not in git)
- `files/sops/` — system SOP PDFs scanned by `scripts/build.py`
- `files/presentations/` — presentation files scanned by `scripts/build.py`
- `files/generated/` — auto-created by Dockerfile (not in git)

### Router Map
| File | Routes |
|---|---|
| `backend/routers/auth.py` | `POST /api/auth/register` (admin JWT required), `/login`, `GET /me` |
| `backend/routers/chat.py` | `POST /api/chat` (SSE streaming, JWT auth) |
| `backend/routers/conversations.py` | `GET/DELETE /api/conversations[/{conv_id}]` |
| `backend/routers/files.py` | `GET /api/files/{path}` (Path.parents security check) |
| `backend/routers/downloads.py` | `GET /api/download/{username}/{conv_id}/{filename}` |
| `backend/routers/news.py` | `GET/POST/PUT/DELETE /api/news[/{id}]`, `POST /api/news/images` |
| `backend/routers/sops.py` | `GET/POST/PUT/DELETE /api/sops[/{id}]`, `POST /api/admin/sops/{id}/remove` (soft-delete, admin) |
| `backend/routers/social.py` | `POST /api/sops/{id}/like`, `/bookmark`, `GET/POST /api/sops/{id}/comments`, `DELETE /api/sops/{id}/comments/{comment_id}`, `GET /api/me/likes`, `/bookmarks` |
| `backend/routers/admin.py` | `GET/POST/PUT/DELETE /api/admin/members[/{id}]`, `PUT /api/admin/papers/{id}`, `GET/PUT /api/admin/ai-config`, `GET/PUT /api/admin/footer` |
| `backend/routers/sop_extract.py` | `POST /api/extract-sop` (admin only, SSE) — on-demand SOP extraction from a paper |

### Service / Store Map
| File | Responsibility |
|---|---|
| `backend/services/user_store.py` | SQLite users; `ensure_admin_exists()` seeds admin/admin |
| `backend/services/social_store.py` | SQLite likes/bookmarks/comments; `_ensure_social_tables()` |
| `backend/services/news_store.py` | CRUD on `data/news.json` |
| `backend/services/sop_store.py` | CRUD on `data/user-sops.json`; hard-delete removes physical file |
| `backend/services/members_store.py` | CRUD on `data/members.js` |
| `backend/services/data_store.py` | Edit paper/book fields in `data/data.json` + regenerate `data/data.js`; allowed fields: `title authors abstract doi directions notes` |
| `backend/services/ai_config_store.py` | Read/write `data/ai_config.json`; `get_masked_config()` shows `****` + last 4 chars |
| `backend/services/rag.py` | BM25Plus index (title+abstract+steps+purpose); `retrieve()`, `retrieve_with_content()` |
| `backend/services/ai_client.py` | Provider classes + `get_provider()` |
| `backend/services/conversation_store.py` | Load/save/list/delete conversations as JSON |
| `backend/services/sop_service.py` | SOP extraction prompts (Chinese-only, 4-category constraint) |
| `backend/config.py` | AI_PROVIDER / *_API_KEY / JWT_SECRET / HOST / PORT env vars |
| `backend/deps.py` | `current_user` + `admin_required` FastAPI dependencies (HTTPBearer) |

## Dependencies
Two requirements files:
- `requirements.txt` — full dev install: includes AI SDKs (`anthropic`, `claude-agent-sdk`), build tools (`pymupdf`, `PyPDF2`, `python-docx`, `python-pptx`, `openpyxl`), and `pytest`. Use locally.
- `requirements-server.txt` — slim Render/prod install: FastAPI, uvicorn, JWT, bcrypt, rank-bm25, PyMuPDF only. No AI SDKs (provider clients use `httpx` directly) and no dev tools.

## Tests
Tests across 12 files in `tests/`. All must pass before committing. Tests that touch the DB use `monkeypatch` to redirect `DB_PATH` to a `tmp_path`. Auth tests use `TestClient` as a context manager so the startup event fires (`ensure_admin_exists` seeds `admin`/`admin`). Registration requires an admin JWT — test helpers log in first to get one.

## Windows-specific
Always use `encoding="utf-8"` on `Path.read_text()` / `write_text()` calls — Chinese filenames and content require explicit UTF-8 on Windows.
