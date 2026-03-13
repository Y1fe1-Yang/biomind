"""
build.py — BioMiND data pipeline.
Scans lab PDF directories, generates data/data.json and data/data.js.

Usage:
    python scripts/build.py              # incremental: append new files
    python scripts/build.py --rebuild    # full rebuild, preserve notes
    python scripts/build.py --extract    # + Kimi API metadata extraction (Plan 2)
"""

import re
import json
import fitz  # PyMuPDF — for PDF thumbnail generation
from pathlib import Path
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_META = {
    "lab": "BioMiND",
    "directions": ["微流控", "光学检测", "细胞分析", "生物传感器"],
}

# Source directories relative to project root
JOURNAL_DIRS = ["1.Journal Articles"]
CONFERENCE_DIRS = ["2.Conference Proceedings"]
BOOKS_DIRS = ["3.Books"]
SOPS_DIR = "files/sops"
PRESENTATIONS_DIR = "files/presentations"


# ---------------------------------------------------------------------------
# ID / metadata helpers
# ---------------------------------------------------------------------------

def generate_id(filename: str, strip_version: bool = False) -> str:
    """Derive a stable slug ID from a filename."""
    # Remove extension
    name = re.sub(r'\.[^.]+$', '', filename)
    # Strip leading numeric prefix like "3." or "26."
    name = re.sub(r'^\d+[._]', '', name)
    # Strip version suffix like "-v2.1" or "_v2"
    if strip_version:
        name = re.sub(r'[-_]v\d+(\.\d+)*$', '', name, flags=re.IGNORECASE)
    # Remove non-ASCII characters (e.g. Chinese)
    name = re.sub(r'[^\x00-\x7F]+', '', name)
    # Replace non-alphanumeric runs with hyphens
    name = re.sub(r'[^a-zA-Z0-9]+', '-', name)
    return name.strip('-').lower()


def detect_year(filename: str) -> int | None:
    m = re.search(r'(20\d{2}|19\d{2})', filename)
    return int(m.group(1)) if m else None


def detect_version(filename: str) -> str | None:
    m = re.search(r'[-_](v\d+(?:\.\d+)*)(?:\.|$)', filename, re.IGNORECASE)
    return m.group(1) if m else None


def detect_date(filename: str) -> str | None:
    m = re.match(r'(\d{4}-\d{2}-\d{2})', filename)
    return m.group(1) if m else None


def deduplicate_ids(entries: list) -> list:
    """Resolve ID collisions by appending the leading numeric file prefix,
    then a sequential counter for any remaining collisions."""
    from collections import Counter

    # Pass 1: append numeric prefix for first-round collisions
    duplicate_ids = {id for id, cnt in Counter(e["id"] for e in entries).items() if cnt > 1}
    if duplicate_ids:
        for entry in entries:
            if entry["id"] in duplicate_ids:
                m = re.match(r'^(\d+)', Path(entry["file"]).name)
                if m:
                    entry["id"] = f"{entry['id']}-{m.group(1)}"

    # Pass 2: sequential suffix for any still-colliding IDs
    seen: dict = {}
    for entry in entries:
        base = entry["id"]
        if base in seen:
            seen[base] += 1
            entry["id"] = f"{base}-{seen[base]}"
        else:
            seen[base] = 1

    return entries


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------

def scan_directory(root: Path) -> dict:
    """
    Scan the BioMiND project root for all PDF assets.

    Journals   : root / "1.Journal Articles"
    Conferences: root / "2.Conference Proceedings"
    Books      : root / "3.Books"
    SOPs       : root / "files/sops"
    Presentations: root / "files/presentations"
    """
    root = Path(root)
    result = {"papers": [], "books": [], "sops": [], "presentations": []}

    # --- Journal papers ---
    for dirname in JOURNAL_DIRS:
        d = root / dirname
        if d.exists():
            for f in sorted(d.glob("*.pdf")):
                result["papers"].append({
                    "id": generate_id(f.name),
                    "type": "journal",
                    "title": "",
                    "authors": [],
                    "year": detect_year(f.name),
                    "journal": "",
                    "doi": "",
                    "file": f"{dirname}/{f.name}",
                    "directions": [],
                    "abstract": "",
                    "notes": {"zh": "", "en": ""},
                })

    # --- Conference proceedings ---
    for dirname in CONFERENCE_DIRS:
        d = root / dirname
        if d.exists():
            for f in sorted(d.glob("*.pdf")):
                result["papers"].append({
                    "id": generate_id(f.name),
                    "type": "conference",
                    "title": "",
                    "authors": [],
                    "year": detect_year(f.name),
                    "journal": "",
                    "doi": "",
                    "file": f"{dirname}/{f.name}",
                    "directions": [],
                    "abstract": "",
                    "notes": {"zh": "", "en": ""},
                })

    # --- Books ---
    for dirname in BOOKS_DIRS:
        d = root / dirname
        if d.exists():
            for f in sorted(d.glob("*.pdf")):
                result["books"].append({
                    "id": f"book-{generate_id(f.name)}",
                    "type": "book",
                    "title": "",
                    "authors": [],
                    "year": detect_year(f.name),
                    "file": f"{dirname}/{f.name}",
                    "directions": [],
                    "abstract": "",
                    "notes": {"zh": "", "en": ""},
                })

    # --- SOPs ---
    sops_dir = root / SOPS_DIR
    if sops_dir.exists():
        for f in sorted(sops_dir.glob("*.pdf")):
            version = detect_version(f.name)
            result["sops"].append({
                "id": f"sop-{generate_id(f.name, strip_version=True)}",
                "title": "",
                "version": version or "v1.0",
                "updated": "",
                "author": "",
                "file": f"{SOPS_DIR}/{f.name}",
                "tags": [],
                "archived": False,
            })

    # --- Presentations ---
    pres_dir = root / PRESENTATIONS_DIR
    if pres_dir.exists():
        for f in sorted(pres_dir.glob("*.pdf")):
            date = detect_date(f.name)
            result["presentations"].append({
                "id": f"pres-{generate_id(f.name)}",
                "title": "",
                "date": date or "",
                "author": "",
                "file": f"{PRESENTATIONS_DIR}/{f.name}",
                "tags": [],
                "summary": {"zh": "", "en": ""},
            })

    return result


# ---------------------------------------------------------------------------
# Note / summary merging
# ---------------------------------------------------------------------------

def merge_notes(existing: dict, new_entry: dict) -> dict:
    """Preserve non-empty notes/summary from the existing entry."""
    for field in ("notes", "summary"):
        if field in existing and field in new_entry:
            for lang in ("zh", "en"):
                if existing[field].get(lang):
                    new_entry[field][lang] = existing[field][lang]
    return new_entry


def _version_key(entry: dict) -> tuple:
    """Return (major, minor) version tuple for sorting SOPs."""
    m = re.search(r'v(\d+)(?:\.(\d+))?', entry.get("version", "v0"), re.IGNORECASE)
    if m:
        return (int(m.group(1)), int(m.group(2) or 0))
    return (0, 0)


def archive_old_sop_versions(sops: list) -> None:
    """Mark older versions of the same SOP as archived (in-place).

    Groups by the raw ID (before dedup), which equals
    'sop-{generate_id(name, strip_version=True)}' — identical for
    protocol-v1.0.pdf and protocol-v2.0.pdf.
    """
    from collections import defaultdict
    by_base: dict = defaultdict(list)
    for s in sops:
        by_base[s["id"]].append(s)
    for group in by_base.values():
        if len(group) > 1:
            group.sort(key=_version_key, reverse=True)
            for old in group[1:]:
                old["archived"] = True


# ---------------------------------------------------------------------------
# PDF thumbnail generation
# ---------------------------------------------------------------------------

def generate_thumbs(papers: list, root: Path) -> None:
    """Render the first page of each paper PDF as a 2× PNG thumbnail.

    Skips papers that already have a thumbnail (incremental).
    Silently skips missing or unreadable PDFs.
    Output: data/thumbs/{id}.png, served at /data/thumbs/{id}.png.
    """
    out_dir = root / "data" / "thumbs"
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in papers:
        thumb_path = out_dir / f"{p['id']}.png"
        if thumb_path.exists():
            continue
        pdf_path = root / p["file"]
        if not pdf_path.exists():
            continue
        try:
            doc = fitz.open(str(pdf_path))
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
            pix.save(str(thumb_path))
            doc.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Data file generation
# ---------------------------------------------------------------------------

def generate_data_files(
    root: Path = None,
    data_dir: Path = None,
    rebuild: bool = False,
) -> None:
    """Generate data/data.json and data/data.js from the project file tree."""
    if root is None:
        root = Path(__file__).parent.parent
    if data_dir is None:
        data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # Load existing data if present
    existing_data: dict = {}
    json_path = data_dir / "data.json"
    if json_path.exists():
        try:
            existing_data = json.loads(json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing_data = {}

    # Build lookup by ID from existing data
    existing_by_id: dict = {}
    for key in ("papers", "books", "sops", "presentations"):
        for entry in existing_data.get(key, []):
            existing_by_id[entry["id"]] = entry

    scanned = scan_directory(root)

    if rebuild:
        # Archive old SOP versions BEFORE dedup (groups by pre-dedup base ID)
        archive_old_sop_versions(scanned["sops"])

        # Dedup all collections (may change IDs)
        for key in ("papers", "books", "sops", "presentations"):
            scanned[key] = deduplicate_ids(scanned[key])

        new_data = scanned
        # Merge notes from existing — enumerate so mutations persist in list
        for key in ("papers", "books", "sops", "presentations"):
            for i, entry in enumerate(new_data[key]):
                if entry["id"] in existing_by_id:
                    new_data[key][i] = merge_notes(existing_by_id[entry["id"]], entry)
    else:
        # Dedup raw scanned entries first
        for key in ("papers", "books", "sops", "presentations"):
            scanned[key] = deduplicate_ids(scanned[key])

        # Incremental: keep existing, append genuinely new IDs
        new_data = {}
        for key in ("papers", "books", "sops", "presentations"):
            existing_ids = {e["id"] for e in existing_data.get(key, [])}
            new_entries = [e for e in scanned[key] if e["id"] not in existing_ids]
            new_data[key] = existing_data.get(key, []) + new_entries

    # Merge meta_cache (AI-extracted titles/abstracts)
    meta_cache = _load_meta_cache(root)
    if meta_cache:
        for key in ("papers", "books"):
            for entry in new_data[key]:
                cached = meta_cache.get(entry["file"])
                if cached and not cached.get("_error"):
                    _apply_meta(entry, cached)

    # Generate PDF thumbnails for papers (incremental, skips existing)
    # Books are excluded by design — only journal/conference PDFs get thumbnails
    generate_thumbs(new_data["papers"], root)

    # Preserve or create meta block
    meta = existing_data.get("meta", DEFAULT_META.copy())
    meta["generated"] = datetime.now(timezone.utc).isoformat()

    final = {"meta": meta, **new_data}

    # Write data.json
    json_path.write_text(
        json.dumps(final, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Write data.js (window.DATA for frontend <script> tag loading)
    js_content = "window.DATA = " + json.dumps(final, ensure_ascii=False, indent=2) + ";"
    (data_dir / "data.js").write_text(js_content, encoding="utf-8")

    print(f"Generated {json_path} and {data_dir / 'data.js'}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _load_meta_cache(root: Path) -> dict:
    cache_file = root / "data" / "meta_cache.json"
    if not cache_file.exists():
        return {}
    try:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _apply_meta(entry: dict, cached: dict) -> None:
    """Overwrite empty entry fields with AI-extracted values from cache."""
    if not entry.get("title") and cached.get("title"):
        entry["title"] = cached["title"]
    if not entry.get("authors") and cached.get("authors"):
        entry["authors"] = cached["authors"]
    if not entry.get("abstract") and cached.get("abstract"):
        entry["abstract"] = cached["abstract"]
    if not entry.get("doi") and cached.get("doi"):
        entry["doi"] = cached["doi"]
    if not entry.get("year") and cached.get("year"):
        entry["year"] = cached["year"]
    if not entry.get("journal") and cached.get("venue"):
        entry["journal"] = cached["venue"]
    elif not entry.get("journal") and cached.get("journal"):
        entry["journal"] = cached["journal"]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="BioMiND data pipeline")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Rebuild full index, preserving notes",
    )
    parser.add_argument(
        "--extract",
        action="store_true",
        help="Extract metadata via Kimi API (requires API key)",
    )
    args = parser.parse_args()

    root = Path(__file__).parent.parent
    if args.extract:
        from scripts.extract_meta import run as extract_run
        extract_run()
    generate_data_files(root=root, rebuild=args.rebuild)
