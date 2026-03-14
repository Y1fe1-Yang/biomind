"""
Parallel SOP extraction — runs N workers concurrently via claude CLI.

Usage:
    python scripts/extract_sops_parallel.py          # 3 workers, all remaining
    python scripts/extract_sops_parallel.py -w 5     # 5 workers
    python scripts/extract_sops_parallel.py --limit 20
    python scripts/extract_sops_parallel.py --force  # re-extract all
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

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

_CC_ENV = {**os.environ, "CLAUDE_CODE_GIT_BASH_PATH": r"D:\Git\usr\bin\bash.exe"}
_CC_TIMEOUT = 300  # seconds per claude call

_lock = threading.Lock()
_print_lock = threading.Lock()


def _log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


# ---------------------------------------------------------------------------
# Claude CLI
# ---------------------------------------------------------------------------

def call_claude_cc(prompt: str) -> str:
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
        raise RuntimeError(f"claude exited {result.returncode}: {result.stderr[:400]}")
    return result.stdout


# ---------------------------------------------------------------------------
# Per-paper pipeline
# ---------------------------------------------------------------------------

def process_paper(paper: dict) -> tuple[str, list[dict] | None, str]:
    """
    Returns (paper_id, new_entries | None, message).
    Called in worker threads — does NOT touch data.json directly.
    """
    pid = paper["id"]
    pdf_path = _ROOT / paper.get("file", "")
    methods_text = extract_pdf_methods(pdf_path)
    abstract_only = False

    if len(methods_text) < 200:
        doi = paper.get("doi", "")
        if not doi:
            return pid, None, "SKIP: short text, no DOI"
        abstract = fetch_abstract_from_crossref(doi)
        if not abstract:
            return pid, None, "SKIP: short text, no CrossRef abstract"
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

    try:
        response_text = call_claude_cc(prompt)
        ai_results = parse_json_response(response_text)
    except Exception as exc:
        return pid, None, f"ERROR: {exc}"

    # Build entries using CURRENT sops list (needs lock — read inside lock below)
    return pid, ai_results, "OK" if not abstract_only else "OK(abstract-only)"


def save_entries(paper: dict, ai_results: list[dict], abstract_only: bool) -> list[dict]:
    """Thread-safe: read data.json, append new entries, write back. Returns new entries."""
    with _lock:
        path = _ROOT / "data" / "data.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        sops = data.get("sops", [])
        new_entries = build_sop_entries(paper, ai_results, sops, abstract_only)
        # Idempotent: remove any prior auto SOPs for this paper first
        data["sops"] = [
            s for s in sops if s.get("source_paper_id") != paper["id"]
        ] + new_entries
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return new_entries


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

def worker(paper: dict, idx: int, total: int) -> bool:
    pid = paper["id"]
    title = paper.get("title", "")[:55]
    _log(f"[{idx}/{total}] START {pid}")

    pid_str, ai_results, msg = process_paper(paper)

    if ai_results is None:
        _log(f"[{idx}/{total}] {msg} — {pid}")
        return False

    abstract_only = msg.endswith("(abstract-only)")
    try:
        new_entries = save_entries(paper, ai_results, abstract_only)
    except Exception as exc:
        _log(f"[{idx}/{total}] SAVE ERROR {pid}: {exc}")
        return False

    for e in new_entries:
        _log(f"[{idx}/{total}] ✓ {e['id']}: {e['title'][:55]}")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _run(workers: int, force: bool, limit: int | None) -> None:
    data = json.loads((_ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    papers = [p for p in data.get("papers", []) if not p.get("archived")]
    done_ids = {s["source_paper_id"] for s in data.get("sops", [])}

    to_process = [p for p in papers if force or p["id"] not in done_ids]
    if limit:
        to_process = to_process[:limit]

    total = len(to_process)
    print(f"Papers to process: {total}  |  Workers: {workers}")
    if total == 0:
        print("Nothing to do.")
        return

    any_new = False
    with ThreadPoolExecutor(max_workers=workers) as exe:
        futures = {
            exe.submit(worker, paper, i + 1, total): paper
            for i, paper in enumerate(to_process)
        }
        for fut in as_completed(futures):
            try:
                ok = fut.result()
                if ok:
                    any_new = True
            except Exception as exc:
                paper = futures[fut]
                _log(f"UNHANDLED {paper['id']}: {exc}")

    if any_new:
        print("\nRegenerating data.js...")
        generate_data_files(root=_ROOT, rebuild=False)
        final = json.loads((_ROOT / "data" / "data.json").read_text(encoding="utf-8"))
        print(f"Done. {len(final.get('sops', []))} total SOPs in data.json.")
    else:
        print("\nNo new SOPs extracted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parallel SOP extraction via claude CLI")
    parser.add_argument("-w", "--workers", type=int, default=3,
                        help="Number of parallel workers (default: 3)")
    parser.add_argument("--force", action="store_true",
                        help="Re-extract even if SOPs exist")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="Process at most N papers")
    args = parser.parse_args()
    _run(args.workers, args.force, args.limit)
