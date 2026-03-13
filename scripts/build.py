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
        new_data = scanned
        # Merge notes from existing — enumerate so mutations persist in list
        for key in ("papers", "books", "sops", "presentations"):
            for i, entry in enumerate(new_data[key]):
                if entry["id"] in existing_by_id:
                    new_data[key][i] = merge_notes(existing_by_id[entry["id"]], entry)
    else:
        # Incremental: keep existing, append genuinely new IDs
        new_data = {}
        for key in ("papers", "books", "sops", "presentations"):
            existing_ids = {e["id"] for e in existing_data.get(key, [])}
            new_entries = [e for e in scanned[key] if e["id"] not in existing_ids]
            new_data[key] = existing_data.get(key, []) + new_entries

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
    generate_data_files(root=root, rebuild=args.rebuild)
    if args.extract:
        print("--extract: Kimi extraction not yet implemented")
