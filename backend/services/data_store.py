"""Paper/book metadata editing backed by data/data.json + data/data.js."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
DATA_JSON = ROOT / "data" / "data.json"
DATA_JS = ROOT / "data" / "data.js"

# Fields that admins are allowed to modify on a paper/book entry
ALLOWED_FIELDS = {"title", "authors", "abstract", "doi", "directions", "notes"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _write_data_js(data: dict) -> None:
    """Regenerate data/data.js from the given data dict."""
    js_body = "window.DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    DATA_JS.write_text(js_body, encoding="utf-8")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_data() -> dict:
    """Return the full data dict from data/data.json."""
    if not DATA_JSON.exists():
        return {}
    return json.loads(DATA_JSON.read_text(encoding="utf-8"))


def save_paper(paper_id: str, updates: dict) -> dict | None:
    """Find a paper or book by id, apply allowed field updates, persist, regenerate JS.

    Returns the updated item dict, or None if not found.
    """
    data = load_data()
    papers = data.get("papers", [])
    books = data.get("books", [])

    # Search both lists
    for collection in (papers, books):
        for i, item in enumerate(collection):
            if item.get("id") == paper_id:
                safe_updates = {k: v for k, v in updates.items() if k in ALLOWED_FIELDS}
                collection[i] = {**item, **safe_updates}
                DATA_JSON.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                _write_data_js(data)
                return collection[i]

    return None
