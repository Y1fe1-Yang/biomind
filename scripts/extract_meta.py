"""
extract_meta.py — PDF metadata extraction via Kimi API.

Usage:
    python scripts/extract_meta.py [--force]

Reads every PDF in 1.Journal Articles/, 2.Conference Proceedings/, 3.Books/,
extracts first-page text, sends to Kimi, and writes structured metadata to
data/meta_cache.json.  Already-processed files are skipped unless --force.

build.py merges this cache into data.json automatically.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx
import PyPDF2

ROOT = Path(__file__).parent.parent
CACHE_FILE = ROOT / "data" / "meta_cache.json"

SCAN_DIRS = [
    ROOT / "1.Journal Articles",
    ROOT / "2.Conference Proceedings",
    ROOT / "3.Books",
]

KIMI_BASE_URL  = "https://api.moonshot.cn"   # SDK appends /v1 itself
KIMI_MODEL_OAI = "moonshot-v1-32k"       # OpenAI-compat (sk-...)
KIMI_MODEL_ANT = "moonshot-v1-32k"       # Anthropic-compat (sk-kimi-...)

EXTRACT_PROMPT = """You are extracting bibliographic metadata from the first page of an academic paper.

Return ONLY a JSON object with these fields (use null if not found):
{
  "title":    "<full paper title>",
  "authors":  ["Last F", "Last F", ...],
  "abstract": "<full abstract text, preserving line breaks as spaces>",
  "journal":  "<journal or conference name>",
  "year":     <4-digit integer or null>,
  "doi":      "<DOI string without https://doi.org/ prefix, or null>",
  "venue":    "<short venue abbreviation, e.g. Lab Chip, Anal. Chem., IEEE MEMS>"
}

Paper text:
"""


def extract_pdf_text(path: Path, max_pages: int = 2) -> str:
    try:
        with open(path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            pages = reader.pages[:max_pages]
            return "\n".join(p.extract_text() or "" for p in pages)
    except Exception as e:
        return f"[ERROR: {e}]"


def kimi_extract(text: str, api_key: str) -> dict:
    """Call Kimi API. Supports both sk-kimi- (Anthropic-compat) and sk- (OpenAI-compat) keys."""
    content = (
        _kimi_anthropic(text, api_key)
        if api_key.startswith("sk-kimi-")
        else _kimi_openai(text, api_key)
    )
    # Strip markdown code fences if present
    content = content.strip()
    if content.startswith("```"):
        content = content.split("```", 2)[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()
    return json.loads(content)


def _kimi_anthropic(text: str, api_key: str) -> str:
    """Use Anthropic SDK with Kimi's Anthropic-compatible base URL."""
    import anthropic
    client = anthropic.Anthropic(api_key=api_key, base_url=KIMI_BASE_URL)
    msg = client.messages.create(
        model=KIMI_MODEL_ANT,
        max_tokens=1024,
        messages=[{"role": "user", "content": EXTRACT_PROMPT + text[:6000]}],
    )
    return msg.content[0].text


def _kimi_openai(text: str, api_key: str) -> str:
    """Use OpenAI-compatible endpoint for standard sk-... keys."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": KIMI_MODEL_OAI,
        "messages": [{"role": "user", "content": EXTRACT_PROMPT + text[:6000]}],
        "temperature": 0.1,
    }
    resp = httpx.post(
        f"{KIMI_BASE_URL}/chat/completions", headers=headers, json=payload, timeout=60
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


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
    pdfs = []
    for d in SCAN_DIRS:
        if d.exists():
            pdfs.extend(sorted(d.glob("*.pdf")))
    return pdfs


def run(force: bool = False) -> None:
    from dotenv import load_dotenv
    import os
    load_dotenv(ROOT / ".env")
    api_key = os.getenv("KIMI_API_KEY", "")
    if not api_key:
        print("ERROR: KIMI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    cache = load_cache()
    pdfs  = all_pdfs()
    total = len(pdfs)

    print(f"Found {total} PDFs.  Cache has {len(cache)} entries.")

    done = 0
    errors = 0
    for i, pdf in enumerate(pdfs, 1):
        key = str(pdf.relative_to(ROOT).as_posix())
        if not force and key in cache:
            print(f"  [{i}/{total}] SKIP  {pdf.name}")
            continue

        print(f"  [{i}/{total}] extract  {pdf.name} ... ", end="", flush=True)
        text = extract_pdf_text(pdf)
        if not text.strip():
            print("no text")
            cache[key] = {"_error": "no text extracted"}
            errors += 1
            continue

        try:
            meta = kimi_extract(text, api_key)
            cache[key] = meta
            title = (meta.get("title") or "")[:60]
            print(f"OK  →  {title}")
            done += 1
        except Exception as e:
            print(f"ERROR: {e}")
            cache[key] = {"_error": str(e)}
            errors += 1

        # Save after every file so progress is preserved on interrupt
        save_cache(cache)
        time.sleep(0.3)   # Kimi rate limit headroom

    print(f"\nDone: {done} extracted, {errors} errors, cache saved to {CACHE_FILE}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Re-extract even if cached")
    args = ap.parse_args()
    run(force=args.force)
