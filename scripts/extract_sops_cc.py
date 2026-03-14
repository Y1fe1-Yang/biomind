"""
Batch SOP extraction using the local Claude Code CLI (no API key required).

Calls `claude --output-format text` via subprocess, piping each prompt through
stdin. Requires the `claude` CLI to be installed and authenticated.

Usage:
    python scripts/extract_sops_cc.py            # skip already-extracted papers
    python scripts/extract_sops_cc.py --force    # re-extract all papers
    python scripts/extract_sops_cc.py --dry-run  # list papers without calling AI
    python scripts/extract_sops_cc.py --limit 5  # process at most N papers
    python scripts/extract_sops_cc.py --paper-id labchip2022  # single paper
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

# Ensure Unicode output on Windows consoles
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-8-sig"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

from backend.services.sop_service import (  # noqa: E402
    _PROMPT_ABSTRACT,
    _PROMPT_FULL,
    build_sop_entries,
    extract_pdf_methods,
    fetch_abstract_from_crossref,
    parse_json_response,
)
from scripts.build import generate_data_files  # noqa: E402

# On Windows, Claude Code needs a bash interpreter to run
_CC_ENV = {**os.environ, "CLAUDE_CODE_GIT_BASH_PATH": r"D:\Git\usr\bin\bash.exe"}
_CC_TIMEOUT = 180  # seconds per paper


# ---------------------------------------------------------------------------
# Claude CLI call
# ---------------------------------------------------------------------------

def call_claude_cc(prompt: str) -> str:
    """Pipe prompt to `claude --output-format text` and return the response."""
    result = subprocess.run(
        ["claude", "--output-format", "text"],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_CC_ENV,
        timeout=_CC_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"claude exited {result.returncode}: {result.stderr[:500]}"
        )
    return result.stdout


# ---------------------------------------------------------------------------
# Extraction pipeline (sync, mirrors sop_service.extract_sop_for_paper)
# ---------------------------------------------------------------------------

def extract_sop_for_paper_cc(
    paper: dict,
    root: Path,
    existing_sops: list[dict],
) -> list[dict]:
    """Extract SOPs for one paper using the local claude CLI."""
    pdf_path = root / paper.get("file", "")
    methods_text = extract_pdf_methods(pdf_path)
    abstract_only = False

    if len(methods_text) < 200:
        doi = paper.get("doi", "")
        if not doi:
            return []
        abstract = fetch_abstract_from_crossref(doi)
        if not abstract:
            return []
        abstract_only = True
        prompt = _PROMPT_ABSTRACT.format(
            title=paper.get("title", ""),
            authors=", ".join(paper.get("authors", [])),
            year=paper.get("year", ""),
            journal=paper.get("journal", ""),
            abstract_text=abstract,
        )
    else:
        prompt = _PROMPT_FULL.format(
            title=paper.get("title", ""),
            authors=", ".join(paper.get("authors", [])),
            year=paper.get("year", ""),
            journal=paper.get("journal", ""),
            methods_text=methods_text,
        )

    response_text = call_claude_cc(prompt)
    ai_results = parse_json_response(response_text)
    return build_sop_entries(paper, ai_results, existing_sops, abstract_only)


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _load_data() -> dict:
    return json.loads((_ROOT / "data" / "data.json").read_text(encoding="utf-8"))


def _save_data(data: dict) -> None:
    (_ROOT / "data" / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _already_extracted(paper_id: str, sops: list[dict]) -> bool:
    return any(s.get("source_paper_id") == paper_id for s in sops)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _run(force: bool, dry_run: bool, limit: int | None, paper_id: str | None) -> None:
    data = _load_data()
    papers = [p for p in data.get("papers", []) if not p.get("archived")]
    sops = data.get("sops", [])

    if paper_id:
        papers = [p for p in papers if p["id"] == paper_id]
        if not papers:
            print(f"ERROR: paper '{paper_id}' not found", file=sys.stderr)
            sys.exit(1)
        to_process = papers
    else:
        to_process = [p for p in papers if force or not _already_extracted(p["id"], sops)]

    if limit:
        to_process = to_process[:limit]

    if dry_run:
        print(f"Would process {len(to_process)} paper(s):")
        for p in to_process:
            status = "extracted" if _already_extracted(p["id"], sops) else "pending"
            print(f"  [{status}] {p['id']}: {p.get('title', '')[:70]}")
        return

    print(f"Processing {len(to_process)} paper(s) via claude CLI...")
    any_new = False

    for i, paper in enumerate(to_process, 1):
        print(f"\n[{i}/{len(to_process)}] {paper['id']}")
        print(f"  {paper.get('title', '')[:70]}")
        try:
            new_entries = extract_sop_for_paper_cc(paper, _ROOT, sops)
        except Exception as exc:
            print(f"  ERROR: {exc}")
            continue

        if not new_entries:
            print("  SKIP: could not extract (short text, no DOI/abstract)")
            continue

        for e in new_entries:
            print(f"  → {e['id']}: {e['title']}")
        sops.extend(new_entries)
        any_new = True

        # Save after each paper so partial runs aren't lost
        data["sops"] = sops
        _save_data(data)

    if any_new:
        print("\nRegenerating data.js...")
        generate_data_files(root=_ROOT, rebuild=False)
        print(f"Done. {len(sops)} total SOPs in data.json.")
    else:
        print("\nNo new SOPs extracted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch SOP extraction via claude CLI")
    parser.add_argument("--force", action="store_true",
                        help="Re-extract even if SOPs already exist")
    parser.add_argument("--dry-run", action="store_true",
                        help="List papers to process without calling AI")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="Process at most N papers")
    parser.add_argument("--paper-id", default=None, metavar="ID",
                        help="Extract a single paper by ID")
    args = parser.parse_args()
    _run(args.force, args.dry_run, args.limit, args.paper_id)
