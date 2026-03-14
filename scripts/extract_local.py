"""
extract_local.py — Local PDF metadata extraction using PyMuPDF (no API key needed).

Extracts: title, abstract, DOI from first 1-2 pages via text heuristics.
Writes to data/meta_cache.json (same format as extract_meta.py / Kimi version).
Already-cached non-error entries are skipped unless --force.

Usage:
    python scripts/extract_local.py
    python scripts/extract_local.py --force   # re-extract all
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF not installed. Run: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).parent.parent
CACHE_FILE = ROOT / "data" / "meta_cache.json"

SCAN_DIRS = [
    ROOT / "1.Journal Articles",
    ROOT / "2.Conference Proceedings",
]

# Regex patterns
DOI_RE = re.compile(r'\b(10\.\d{4,}/[^\s"<>\]\[,;]+)')
ABSTRACT_START_RE = re.compile(
    r'A\s*B\s*S\s*T\s*R\s*A\s*C\s*T|Abstract',
    re.IGNORECASE,
)
ABSTRACT_STOP_RE = re.compile(
    r'\n\s*(?:\d+[\.\)]\s+[A-Z]|[IVX]+\.\s+[A-Z])'
    r'|\b(?:Introduction|INTRODUCTION|Keywords|KEYWORDS|Graphical Abstract)\b',
)
GARBAGE_TITLE_RE = re.compile(
    r'^(?:microsoft\s+word|untitled|unknown|none|document|\s*|-+|\d+)',
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Title extraction
# ---------------------------------------------------------------------------

def _title_from_metadata(doc) -> str:
    raw = (doc.metadata.get("title") or "").strip()
    if raw and len(raw) > 8 and not GARBAGE_TITLE_RE.match(raw):
        return re.sub(r'\s+', ' ', raw)[:300]
    return ""


def _title_from_blocks(page) -> str:
    """Find likely title = largest-font text cluster in top 60 % of page 1."""
    try:
        data = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    except Exception:
        return ""

    page_height = page.rect.height
    spans: list[tuple[float, float, str]] = []  # (size, y, text)

    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                size = span.get("size", 0.0)
                y = block["bbox"][1]
                if len(text) > 8 and size > 0 and y < page_height * 0.62:
                    spans.append((size, y, text))

    if not spans:
        return ""

    max_size = max(s[0] for s in spans)
    threshold = max_size * 0.82

    # Collect candidate spans near max size, sorted top-to-bottom
    candidates = sorted(
        [(y, text) for size, y, text in spans if size >= threshold],
        key=lambda x: x[0],
    )

    # Merge spans that are close together vertically
    parts: list[str] = []
    prev_y = -999.0
    for y, text in candidates:
        if parts and y - prev_y > 55:
            break  # new section — stop
        parts.append(text)
        prev_y = y

    title = re.sub(r'\s+', ' ', " ".join(parts)).strip()
    return title[:300] if len(title) > 8 else ""


def extract_title(doc) -> str:
    t = _title_from_metadata(doc)
    if t:
        return t
    if len(doc) > 0:
        t = _title_from_blocks(doc[0])
    return t


# ---------------------------------------------------------------------------
# Abstract extraction
# ---------------------------------------------------------------------------

def extract_abstract(text: str) -> str:
    m = ABSTRACT_START_RE.search(text)
    if not m:
        return ""

    after = text[m.end(): m.end() + 4000]
    after = re.sub(r'^[\s:—–\-]+', '', after)

    stop = ABSTRACT_STOP_RE.search(after)
    if stop:
        after = after[: stop.start()]

    abstract = re.sub(r'\s+', ' ', after).strip()
    return abstract[:2000] if len(abstract) >= 50 else ""


# ---------------------------------------------------------------------------
# DOI extraction
# ---------------------------------------------------------------------------

def extract_doi(text: str) -> str:
    m = DOI_RE.search(text)
    if m:
        return m.group(1).rstrip('.,;:)')
    return ""


# ---------------------------------------------------------------------------
# Per-file processing
# ---------------------------------------------------------------------------

def process_pdf(pdf_path: Path) -> dict:
    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        return {"_error": f"cannot open: {e}"}

    try:
        n = min(len(doc), 2)
        full_text = "\n".join(doc[i].get_text() for i in range(n))

        if not full_text.strip():
            return {"_error": "no text layer (scanned PDF)"}

        return {
            "title":    extract_title(doc),
            "abstract": extract_abstract(full_text),
            "doi":      extract_doi(full_text),
            "authors":  [],
            "journal":  "",
            "year":     None,
            "venue":    "",
        }
    except Exception as e:
        return {"_error": str(e)}
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def load_cache() -> dict:
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def all_pdfs() -> list[Path]:
    pdfs: list[Path] = []
    for d in SCAN_DIRS:
        if d.exists():
            pdfs.extend(sorted(d.glob("*.pdf")))
    return pdfs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(force: bool = False) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    cache = load_cache()
    pdfs  = all_pdfs()
    total = len(pdfs)
    print(f"Found {total} PDFs. Cache has {len(cache)} entries.")

    done = skipped = errors = 0

    for i, pdf in enumerate(pdfs, 1):
        key = str(pdf.relative_to(ROOT).as_posix())

        if not force and key in cache and not cache[key].get("_error"):
            skipped += 1
            continue

        label = pdf.name[:55]
        print(f"  [{i:>3}/{total}] {label:<55} ... ", end="", flush=True)
        result = process_pdf(pdf)

        if result.get("_error"):
            print(f"ERR  {result['_error']}")
            errors += 1
        else:
            ti = (result["title"] or "(no title)")[:45]
            ab = "abs+" if result["abstract"] else "no-abs"
            do = f"doi+" if result["doi"] else "no-doi"
            print(f"{ab}  {do}  {ti}")
            done += 1

        cache[key] = result
        save_cache(cache)

    print(f"\nDone: {done} extracted, {skipped} skipped, {errors} errors")
    print(f"Cache: {CACHE_FILE}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Local PDF metadata extraction (PyMuPDF)")
    ap.add_argument("--force", action="store_true", help="Re-extract even if cached")
    args = ap.parse_args()
    run(force=args.force)
