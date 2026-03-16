# Admin Panel Design — BioMiND

**Date:** 2026-03-16
**Status:** Approved by user

---

## Overview

A standalone admin panel at `/admin` for managing all dynamic content on the BioMiND site. Only accessible to users with `is_admin=true`. Uses the existing JWT auth system.

---

## Architecture

### Frontend

- `frontend/admin/index.html` — standalone HTML shell (not part of the main SPA)
- `frontend/admin/admin.js` — all panel logic (router, views, API calls)
- `frontend/admin/admin.css` — panel styles
- **EasyMDE** — Markdown editor for news body (loaded from CDN)
- **marked.js** — Markdown rendering for news preview and display (loaded from CDN)
- **Auth guard:** on page load, call `GET /api/auth/me` with stored JWT. If the request fails (401) or `is_admin` is false, redirect to `/`. The `localStorage` flag `biomind_is_admin` is for UX only; server-side `admin_required` enforces all actual access.

**Serving `/admin`:** A dedicated FastAPI route `GET /admin` (and `GET /admin/`) in `main.py` returns `FileResponse("frontend/admin/index.html")`. This ensures direct URL navigation works. The `frontend/` static mount does not auto-serve subdirectory index files.

### Backend

New router: `backend/routers/admin.py`
All routes under `/api/admin/`, all require the existing `admin_required` dependency.

New service: `backend/services/pdf_service.py`
Handles PDF thumbnail rendering and AI metadata extraction.

**Additions to `backend/services/user_store.py`:**
- `delete_user(username: str) -> None` — removes user row; raises `ValueError` if user is the last admin
- `set_password(username: str, new_password: str) -> None` — bcrypt-hashes and updates
- `set_admin(username: str, is_admin: bool) -> None` — updates admin flag; raises `ValueError` if demoting last admin

### Data Storage

| File | Purpose | Format | HTTP-accessible? |
|------|---------|--------|-----------------|
| `data/members.json` | Canonical members source | JSON array | No — excluded (see below) |
| `data/news.json` | Canonical news source | JSON array | No — excluded |
| `data/settings.json` | API keys and settings (**gitignored**) | JSON object | No — excluded |
| `data/admin_log.json` | Append-only activity log (**gitignored**) | JSON array | No — excluded |
| `data/thumbs/` | PDF first-page thumbnails | PNG | Yes — public |
| `data/publications/` | Uploaded PDF files | PDF | No — excluded |
| `data/members.js` | Auto-regenerated | JS (window.MEMBERS) | Yes — public |
| `data/news.js` | Auto-regenerated | JS (window.NEWS) | Yes — public |
| `data/data.json` | Canonical publications (existing) | JSON | No — excluded |
| `data/data.js` | Auto-regenerated | JS (window.DATA) | Yes — public |

**Static mount restructure (`main.py`):** The current `app.mount("/data", StaticFiles(directory=data_dir))` exposes **all** of `data/` publicly — including `users.db`, `settings.json`, etc. This is a pre-existing security gap that the admin panel would worsen. The broad `/data` mount is **replaced** with targeted routes (registered before the `frontend/` catch-all):

```python
app.mount("/data/thumbs", StaticFiles(directory=str(data_dir / "thumbs")), name="thumbs")

@app.get("/data/members.js")
def serve_members_js(): return FileResponse(str(data_dir / "members.js"), media_type="application/javascript")

@app.get("/data/news.js")
def serve_news_js(): return FileResponse(str(data_dir / "news.js"), media_type="application/javascript")

@app.get("/data/data.js")
def serve_data_js(): return FileResponse(str(data_dir / "data.js"), media_type="application/javascript")
```

Everything else in `data/` remains inaccessible via HTTP.

**Route registration order in `main.py`:** FastAPI processes routes in registration order. The `GET /admin` route and all `/api/admin/*` router must be included **before** `app.mount("/", StaticFiles(..., html=True))`. Failure to do so causes the catch-all frontend mount to intercept admin requests.

**Concurrent write safety:** All JSON file writes use a per-file `threading.Lock` (not `asyncio.Lock`, since admin endpoints are synchronous `def` consistent with the rest of the codebase). Stored in a module-level dict in `backend/services/file_store.py`. The helper exposes `read_json(path)` and `write_json(path, data)` — the latter acquires the lock, writes atomically (write to `.tmp` then `os.replace`), and releases.

**Settings file schema** (`data/settings.json`):
```json
{
  "ai_provider": "zhipu",
  "zhipu_api_key": "sk-...",
  "claude_api_key": "",
  "kimi_api_key": "",
  "jwt_secret": ""
}
```
In `GET /api/admin/settings`, keys are masked: `"sk-****...xxxx"` (first 3 chars + `****` + last 4 chars). `jwt_secret` is always fully masked. Environment variables still override `settings.json` at runtime; `backend/config.py` reads `settings.json` as a secondary fallback (after env vars, before hardcoded defaults).

### .js Regeneration

A shared utility function in `backend/services/file_store.py`:

```python
def write_window_js(js_path: Path, var_name: str, data: list) -> None:
    """Write data as window.VAR = [...]; JS file."""
    content = f"window.{var_name} = {json.dumps(data, ensure_ascii=False, indent=2)};\n"
    js_path.write_text(content, encoding="utf-8")
```

Called after every write:
- Members write → `write_window_js(data/members.js, "MEMBERS", members)`
- News write → `write_window_js(data/news.js, "NEWS", news)`
- Publications write → `write_window_js(data/data.js, "DATA", data)` (same as `scripts/build.py` output)

### ID Generation

- **Members:** human-readable slug derived from English name (e.g., `"Yang Hui"` → `"yang-hui"`). If slug already exists, append `-2`, `-3`, etc. This matches existing `data/members.js` IDs and is used for frontend lookups.
- **News:** human-readable slug from English title, truncated to 40 chars, e.g., `"afm-mxene-2024"`. Same collision-avoidance as members.
- **Publications:** use existing `id` field from `data/data.json` if present; for new uploads, generate slug from `{first-author-lastname}-{journal-abbrev}-{year}`.

---

## Migration from JS to JSON

**When:** Run manually once (`python scripts/migrate_to_json.py`) before deploying the admin panel. Not a startup event.

**Why Node.js subprocess:** `data/members.js` and `data/news.js` use JS object literal syntax (unquoted keys: `id: "yang-hui"`, `name: { zh: "..." }`). This is **not valid JSON** — `json.loads` will fail. A Node.js subprocess parses the files correctly:

```python
import subprocess, json, pathlib

def js_to_json(js_path: str, var_name: str) -> list:
    code = f"""
const vm = require('vm'); const fs = require('fs');
const ctx = {{window:{{}}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(String.raw`{js_path}`, 'utf8'), ctx);
process.stdout.write(JSON.stringify(ctx.window.{var_name}));
"""
    result = subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)

# Usage
members = js_to_json('data/members.js', 'MEMBERS')
pathlib.Path('data/members.json').write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding='utf-8')

news = js_to_json('data/news.js', 'NEWS')
pathlib.Path('data/news.json').write_text(json.dumps(news, ensure_ascii=False, indent=2), encoding='utf-8')
```

Node.js is confirmed available (used in previous sessions for `.js` file validation). The script is idempotent — skips files that already exist.

---

## Dashboard Module

**Data sources** (computed at request time from existing files/DB):
- User count: `len(list_users())`
- Member count: `len(read_json("data/members.json"))`
- News count: `len(read_json("data/news.json"))`
- Publication count: `len(data["items"])` from `data/data.json`
- Current AI provider: from `backend/config.AI_PROVIDER`
- Recent activity: last 20 entries from `data/admin_log.json`

**API:** `GET /api/admin/dashboard` returns:
```json
{
  "users": 3, "members": 12, "news": 5, "publications": 47,
  "ai_provider": "zhipu", "recent_activity": [...]
}
```

**Widgets shown:**
- 4 stat cards (users / members / news / publications)
- AI model indicator card
- 4 quick-action buttons (邀请用户 / 发布新闻 / 添加成员 / 更新 API Key)
- Activity log list (last 20 entries, newest first)

---

## Sidebar Modules

1. **仪表盘** — stat cards + quick actions + activity log
2. **用户管理** — user table, create user form (username + password), delete user, reset password, toggle admin flag
3. **成员管理** — member card grid, add/edit form with bilingual fields (name ZH/EN, title ZH/EN, email, photo URL, research areas ZH/EN, education ZH/EN, bio ZH/EN)
4. **新闻管理** — article list, add/edit with EasyMDE Markdown editor + cover image URL + extra image URLs, bilingual title/excerpt, Markdown body (ZH/EN tabs)
5. **文献管理** — publication list table + search/filter, PDF upload workflow (see below)
6. **AI 设置** — provider selector (zhipu / claude / kimi), API key input (masked), test-connection button that calls `POST /api/chat` with a hello message
7. **系统设置** — JWT secret update (shows masked value), current host/port info (read-only)

---

## API Endpoints

All require `Authorization: Bearer <admin-jwt>`.

### Dashboard
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/dashboard` | Counts + recent activity |

### Users
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user (uses existing `register_user`) |
| PATCH | `/api/admin/users/{username}` | Reset password / toggle admin |
| DELETE | `/api/admin/users/{username}` | Delete user |

### Members
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/members` | List |
| POST | `/api/admin/members` | Create |
| PUT | `/api/admin/members/{id}` | Update |
| DELETE | `/api/admin/members/{id}` | Delete |

### News
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/news` | List |
| POST | `/api/admin/news` | Create |
| PUT | `/api/admin/news/{id}` | Update |
| DELETE | `/api/admin/news/{id}` | Delete |

### Publications
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/publications` | List (from data/data.json) |
| POST | `/api/admin/publications/upload` | Upload PDF → return extracted metadata |
| POST | `/api/admin/publications` | Save reviewed publication |
| PUT | `/api/admin/publications/{id}` | Update existing entry |
| DELETE | `/api/admin/publications/{id}` | Delete entry (does not delete PDF file) |

### Settings
| Method | Path | Action |
|--------|------|--------|
| GET | `/api/admin/settings` | Get settings (keys masked) |
| PUT | `/api/admin/settings` | Update settings |

---

## Publications: Existing vs. Uploaded

**Existing entries** in `data/data.json` have `"file": "1.Journal Articles/..."` paths. These entries are editable in the admin panel (title, abstract, tags, etc.) but their `file` paths are treated as read-only (displayed but not changed via the upload flow).

**New uploads** via the admin panel store PDFs at `data/publications/{uuid}.pdf` and set `"file": "publications/{uuid}.pdf"` in the new entry. Both path conventions coexist in `data/data.json`. The frontend uses the `file` field only for download links (already behind `/api/download/`), so both conventions work transparently.

---

## PDF Upload Workflow

**Steps shown in UI:** 上传 PDF → 渲染封面 → AI 提取元数据 → 审核 & 保存

1. Client uploads PDF via `multipart/form-data` to `POST /api/admin/publications/upload`
2. Backend validates: MIME type `application/pdf`, max 20 MB; rejects otherwise (400)
3. **PyMuPDF** renders page 0 → PNG at 150 DPI → saved to `data/thumbs/{uuid}.png` (matches existing `scripts/build.py` convention)
4. **PyMuPDF** extracts text from pages 0–1 (first two pages)
5. Text sent to **GLM-4-Flash** with structured prompt returning JSON:
   ```json
   {"title":"...", "authors":"...", "journal":"...", "year":"...",
    "doi":"...", "abstract":"...", "keywords":"...",
    "category":"Journal Article", "category_confidence": 0.94}
   ```
6. API responds with all extracted fields + thumbnail URL
7. Admin reviews/edits all fields in form
8. `POST /api/admin/publications` writes entry to `data/data.json` → regenerates `data/data.js`

**Note:** PyMuPDF (`fitz`) is already present in the project (used by `scripts/build.py`) — no new dependency.

---

## News Body: Markdown

- Stored as Markdown string in `data/news.json`
- Edited via EasyMDE (toolbar: bold, italic, H2/H3, image URL, link, preview toggle)
- Rendered in frontend `showNewsDetail()` via `marked.js` replacing current `split("\n\n")` paragraph logic
- Existing news bodies (plain paragraphs separated by `\n\n`) are valid Markdown — no migration needed

---

## Activity Log

Append-only `data/admin_log.json` (gitignored, not HTTP-served). Each entry:
```json
{"ts": 1710000000, "actor": "admin", "action": "create_news", "detail": "hLife | ..."}
```
Written by admin router after each successful mutation. Dashboard shows last 20 entries.

---

## Security

- All `/api/admin/*` endpoints require `admin_required` → 401 if no token, 403 if not admin
- `/admin` page JS calls `GET /api/auth/me` on load; redirects to `/` if 401 or `is_admin=false`. Frontend security is UX-only; server enforces everything.
- **Static file exposure:** `data/settings.json`, `data/admin_log.json`, `data/members.json`, `data/news.json`, `data/publications/` are **not served** by the static mount. Only `.js` files and `thumbnails/` are public.
- PDF uploads: validate MIME type, 20 MB size limit, UUID-based filenames (no path traversal)
- API keys in `GET /api/admin/settings`: masked as `sk-****...xxxx`
- Users: cannot delete or demote own account (enforced server-side in `user_store.py` new functions)

---

## Dependencies

| Package | Use | Status |
|---------|-----|--------|
| `pymupdf` (PyMuPDF / fitz) | PDF thumbnail + text extraction | **Already in project** |
| EasyMDE (CDN) | Markdown editor in admin panel | New (frontend only) |
| marked.js (CDN) | Markdown rendering | New (frontend only) |

No new Python packages required.

**Note on `requirements.txt`:**
- Change `passlib[bcrypt]` → `bcrypt` (user_store.py already uses `bcrypt` directly; passlib is unused and breaks Python 3.14)
- Add `python-multipart` (required by FastAPI for `UploadFile` / multipart form data; used by `POST /api/admin/publications/upload`)

---

## File Tree (new files)

```
frontend/
  admin/
    index.html        ← admin panel shell
    admin.js          ← all panel logic
    admin.css         ← panel styles
backend/
  routers/
    admin.py          ← all /api/admin/* routes
  services/
    pdf_service.py    ← PyMuPDF thumbnail + AI extraction
    file_store.py     ← read_json/write_json with locking + write_window_js
data/
  members.json        ← generated from members.js on first startup
  news.json           ← generated from news.js on first startup
  settings.json       ← gitignored, API keys
  admin_log.json      ← gitignored, activity log
  thumbnails/         ← PDF cover images (public)
  publications/       ← uploaded PDFs (not HTTP-served)
docs/
  superpowers/
    specs/
      2026-03-16-admin-panel-design.md
```
