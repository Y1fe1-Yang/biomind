"""
Batch SOP extraction script.

Extracts experiment protocols from paper PDFs and writes them to data/data.json.

Usage:
    python scripts/extract_sops.py            # skip already-extracted papers
    python scripts/extract_sops.py --force    # re-extract all papers
    python scripts/extract_sops.py --dry-run  # print papers that would be processed
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

# Ensure Unicode output works on Windows consoles (GBK → UTF-8)
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

from backend.config import CLAUDE_API_KEY
from backend.services.sop_service import extract_sop_for_paper
from scripts.build import generate_data_files


def _load_data() -> dict:
    path = _ROOT / "data" / "data.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _save_data(data: dict) -> None:
    path = _ROOT / "data" / "data.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _already_extracted(paper_id: str, sops: list[dict]) -> bool:
    return any(s.get("source_paper_id") == paper_id for s in sops)


async def _run(force: bool, dry_run: bool) -> None:
    data = _load_data()
    papers = [p for p in data.get("papers", []) if not p.get("archived")]
    sops = data.get("sops", [])

    to_process = [
        p for p in papers
        if force or not _already_extracted(p["id"], sops)
    ]

    if dry_run:
        print(f"Would process {len(to_process)} paper(s):")
        for p in to_process:
            print(f"  {p['id']}: {p.get('title', '(no title)')}")
        return

    # Only check API key when we're actually going to extract
    if not CLAUDE_API_KEY:
        print("ERROR: CLAUDE_API_KEY not set. Aborting.", file=sys.stderr)
        sys.exit(1)

    print(f"Processing {len(to_process)} paper(s)...")
    any_new = False

    for i, paper in enumerate(to_process, 1):
        print(f"[{i}/{len(to_process)}] {paper['id']} — {paper.get('title', '')[:60]}")
        try:
            new_entries = await extract_sop_for_paper(
                paper, _ROOT, CLAUDE_API_KEY, sops
            )
        except Exception as exc:
            print(f"  ERROR: {exc}")
            continue

        if not new_entries:
            print("  SKIP: could not extract (short text, no DOI)")
            continue

        for e in new_entries:
            print(f"  → {e['id']}: {e['title']}")
        sops.extend(new_entries)
        any_new = True

    if any_new:
        data["sops"] = sops
        _save_data(data)
        print("Regenerating data.js...")
        generate_data_files(root=_ROOT, rebuild=False)
        print("Done.")
    else:
        print("No new SOPs extracted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch SOP extraction")
    parser.add_argument("--force", action="store_true",
                        help="Re-extract even if SOPs already exist")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print papers to be processed without calling API")
    args = parser.parse_args()
    asyncio.run(_run(args.force, args.dry_run))
