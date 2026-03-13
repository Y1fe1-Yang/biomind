# BioMiND Homepage Redesign — Design Spec

**Date:** 2026-03-14
**Status:** Approved (post-review v2)
**Design direction:** Academic Portal (学术门户)

---

## 1. Context

BioMiND (Laboratory of Biomedical Microsystems and Nano Devices) is a multidisciplinary research lab combining engineering, physics, information science, biology, and chemistry. The platform serves two audiences:

- **Public visitors** (collaborators, prospective students, peers): need to understand who BioMiND is, what they publish, and what they research
- **Lab members** (logged-in users): access SOP library and AI assistant

Currently the app has no homepage — it goes straight to a paper timeline after login. The redesign adds a proper public-facing homepage.

---

## 2. Access Model

| Section | Public | Login required |
|---|---|---|
| Homepage | ✓ | |
| Full paper timeline | ✓ | |
| Research directions | ✓ | |
| Lab sharing (组内分享) | ✓ | |
| SOP library | | ✓ |
| AI assistant | | ✓ |

---

## 3. Homepage Structure

### 3.1 Navigation Bar (sticky)

```
[BioMiND logo] [主页] [文献] [研究方向] [组内分享] [SOP 库 🔒]   [search] [中/EN] [登录]
```

- Logo: bold, `#1e3a8a`
- Active link: `#eff6ff` background, `#1d4ed8` text
- SOP 库 has lock icon (🔒) to signal login-required
- After login: replace 登录 button with username + 退出
- Search bar: `border-radius: 20px`, placeholder "搜索标题、摘要、标签..."

### 3.2 Hero Section

```
LABORATORY OF BIOMEDICAL MICROSYSTEMS AND NANO DEVICES  ← small caps, gray
BioMiND  生物医学微系统与纳米器件实验室               ← 40px bold + 17px subtitle
综合运用工程科学、物理科学、信息科学…               ← 15px description, 2 lines
[生物传感] [微纳器件] [等离激元光学] [微流控] [单细胞分析] [即时检测]  ← tag pills
```

- Background: subtle blue-tinted gradient `linear-gradient(160deg, #eef4ff, #f8fafe, #f5f5ff)`
- Decorative radial glow (CSS only, no images needed)
- Tags: white background, `#bfdbfe` border, `#1d4ed8` text

### 3.3 Latest Publications (4 cards)

2-column grid. Each card:

```
[PDF thumbnail 78×104px] | [期刊/综述 badge] [year badge]
                          | Title (2-line clamp, 13px bold)
                          | Journal · Year (italic, 11px gray)
                          | Abstract (3-line clamp, 11px)
                          | [direction tag] [direction tag]
```

- **Entire card is an `<a>` element**:
  - If `doi` non-empty → `href="https://doi.org/{doi}" target="_blank"`
  - If `doi` empty → `href="/api/files/{file}" target="_blank"` (opens PDF directly)
- No DOI label text shown anywhere on the card
- Hover: `border-color: #93c5fd`, `box-shadow: 0 6px 20px rgba(29,78,216,.1)`, `translateY(-2px)`, title color → `#1d4ed8`
- PDF thumbnail: `<img src="/data/thumbs/{id}.png" onerror="this.style.display='none'">` — hides gracefully if thumb missing
- "Latest" = top 4 entries from `data.papers` sorted by `year` desc (ties keep original order)
- "查看全部文献 →" navigates to `timeline` view (calls `showView('timeline')`)

### 3.4 Research Directions (4 cards)

1-row grid of 4 hardcoded cards (directions are stable lab identity, not auto-computed). Each card: icon + name + keyword subtitle. Cards link to the `/directions` view.

Fixed mapping (icon → name → subtitle):

| Icon | Name | Subtitle |
|------|------|----------|
| 🔬 | 生物传感与即时检测 | 基于电化学/光学传感 |
| 💡 | 等离激元纳米光子学 | SPR / LSPR 平台 |
| 🧫 | 微流控与单细胞分析 | Lab-on-chip · 膜蛋白 |
| ⚡ | 柔性微纳器件 | MXene · 可穿戴传感 |

The `directions` field on paper entries (e.g. `["生物传感与即时检测", "微流控"]`) is used only on the paper cards (§3.3 direction tags) — it does not drive the direction cards in this section.

### 3.5 Footer

Dark blue (`#1a2d6d`) footer with lab full name in Chinese and English, copyright.

---

## 4. Data Pipeline Changes

### 4.1 PDF Thumbnail Generation (`scripts/build.py`)

New function `generate_thumbs(papers, root)` called inside `generate_data_files()` immediately after `new_data` is assembled, passing `new_data["papers"]` (journals + conferences only — books are excluded):

```python
import fitz  # PyMuPDF

def generate_thumbs(papers, root):
    """Render first page of each paper PDF as a PNG thumbnail.
    Skips existing thumbnails (incremental). Called with papers list only (not books).
    """
    out_dir = root / "data" / "thumbs"
    out_dir.mkdir(exist_ok=True)   # creates dir if absent — safe to call every run
    for p in papers:
        thumb_path = out_dir / f"{p['id']}.png"
        if thumb_path.exists():
            continue  # incremental — skip already-rendered
        pdf_path = root / p['file']
        if not pdf_path.exists():
            continue
        try:
            doc = fitz.open(str(pdf_path))
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
            pix.save(str(thumb_path))
            doc.close()
        except Exception:
            pass  # silently skip corrupt/unreadable PDFs
```

Call site in `generate_data_files()`:
```python
generate_thumbs(new_data["papers"], root)   # after new_data is assembled, before writing JSON
```

**Serving:** `data/thumbs/` is served at `/data/thumbs/` via the existing `StaticFiles(directory="data")` mount in `main.py`. The `out_dir.mkdir(exist_ok=True)` inside `generate_thumbs` ensures the directory exists before the server starts. `main.py` already does `data_dir.mkdir(parents=True, exist_ok=True)` at startup as a fallback.

### 4.2 Metadata Fields Used

Each paper entry in `data.json` uses:

| Field | Source | Notes |
|---|---|---|
| `id` | build.py (existing) | Used as thumbnail filename |
| `title` | meta_cache.json or PDF extraction | Previously empty for most |
| `abstract` | meta_cache.json or PDF extraction | Previously empty |
| `doi` | PDF text extraction (regex `10\.\d{4,}/...`) | Previously empty |
| `directions` | Semantic tag list | e.g. `["生物传感与即时检测", "微流控"]` |
| `year` | build.py (existing) | Sort key |
| `type` | build.py (existing) | `journal` / `conference` |

### 4.3 New Route: Homepage View

Add `home` as the default route in `app.js`. Current default is `timeline`.

---

## 5. Frontend Changes

### 5.1 New View: `renderHome()`

New function in `frontend/assets/app.js` that renders HTML directly into the `#view-home` div:

```javascript
function renderHome() {
  const papers = (window.DATA.papers || [])
    .slice()
    .sort((a, b) => (b.year || 0) - (a.year || 0))
    .slice(0, 4);

  document.getElementById("view-home").innerHTML = buildHomeHTML(papers);
  applyI18n();
}
```

- No auth required — renders for all visitors
- Card link: `doi` present → `href="https://doi.org/{doi}" target="_blank"`, else → `href="/api/files/{encodeURIComponent(file)}" target="_blank"`
- Thumbnail: `<img src="/data/thumbs/{id}.png" onerror="this.style.display='none'">`
- Direction tags rendered from `paper.directions` array (may be empty array — no tags shown if absent)

### 5.2 Router + HTML container update

**`index.html`:** Add `<div id="view-home" class="hidden"></div>` alongside the other view containers (`view-timeline`, `view-directions`, etc.). Add `主页` nav button with `data-view="home"`.

**`app.js` — `showView(name)` function:** The existing function already iterates all `[id^="view-"]` elements and toggles `hidden`. No change needed to `showView()` itself — it will find `view-home` automatically.

**`app.js` — `renders` dispatch table:** Add `home: renderHome` entry.

**`app.js` — `boot()` function:** Currently calls `await showAuthModal()` when no token found, blocking all rendering. Change boot to:
1. Always call `showView("home")` first (renders public homepage immediately)
2. Only show auth modal if user navigates to a protected view (`sops`, `ai`) — not on initial load

```javascript
async function boot() {
  applyI18n();
  updateNavUser();
  showView("home");          // always render home first — no auth gate
  // Auth modal shown on-demand when protected route is accessed
}
```

### 5.3 Nav Update

Add `主页` nav button to `index.html` nav, `data-view="home"`. Nav active state already driven by `showView()` which sets `active` class on the matching `data-view` button.

### 5.4 Tailwind / CSS

New classes needed (added to `frontend/assets/input.css` and recompiled):
- Paper card grid: `grid-cols-2`, `gap-5`
- Card hover effects: already covered by Tailwind utilities
- Hero gradient: custom CSS in `input.css`
- Tag pills: Tailwind utilities

---

## 6. i18n

New `home` key added to both files with distinct values:

**`zh.js`:**
```javascript
home: {
  eyebrow: "Laboratory of Biomedical Microsystems and Nano Devices",
  titleZh: "生物医学微系统与纳米器件实验室",
  desc: "综合运用工程科学、物理科学、信息科学、生物科学与化学科学的新技术，致力于前沿生物医学微纳系统与器件研究，推动多学科交叉融合创新。",
  latestPubs: "最新发表",
  viewAll: "查看全部文献 →",
  directions: "研究方向",
  directionsMore: "详细介绍 →",
  multiDisc: "多学科交叉",
  papers: "篇",
}
```

**`en.js`:**
```javascript
home: {
  eyebrow: "Laboratory of Biomedical Microsystems and Nano Devices",
  titleZh: "Biomedical Microsystems & Nano Devices Lab",
  desc: "Integrating engineering, physics, information science, biology and chemistry to advance frontier biomedical microsystems and nanodevices research.",
  latestPubs: "Latest Publications",
  viewAll: "View all papers →",
  directions: "Research Directions",
  directionsMore: "Learn more →",
  multiDisc: "Multidisciplinary",
  papers: "",
}
```

---

## 7. Files Modified

| File | Change |
|---|---|
| `frontend/index.html` | Add `主页` nav link; keep existing structure |
| `frontend/assets/app.js` | Add `renderHome()`, update router default |
| `frontend/assets/input.css` | Add hero gradient, card hover, tag pill styles |
| `frontend/assets/style.css` | Recompile Tailwind |
| `frontend/i18n/zh.js` | Add `home` i18n section |
| `frontend/i18n/en.js` | Add `home` i18n section |
| `scripts/build.py` | Add `generate_thumbs()` step |
| `requirements.txt` | Add `pymupdf` |
| `data/thumbs/` | Created by build.py; PNG files generated by `generate_thumbs()`; gitignored |
| `data/data.json` | Papers already updated manually with title/abstract/doi for top 4; build.py preserves these fields on re-scan |

---

## 8. Out of Scope

- Mass metadata extraction for all 58+ papers (separate task — needs AI API or manual entry)
- Team/members page
- News/announcements feed
- Mobile responsive layout (follow-up)
