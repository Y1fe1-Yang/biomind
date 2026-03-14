"""
BM25-based retrieval for lab knowledge.

Indexes all papers, books, SOPs, and presentations from data/data.json.
Each entry becomes one "document" (title + type + tags joined as a bag-of-words).

Usage:
    from backend.services.rag import retrieve
    hits = retrieve("MEMS fabrication protocol", top_k=5)
    # hits: list of dicts with keys: id, title, type, file, score, ...
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent.parent
DATA_FILE = ROOT / "data" / "data.json"

# Module-level cache so the index is built once per process.
_index: "BM25Index | None" = None


class BM25Index:
    def __init__(self, entries: list[dict]) -> None:
        from rank_bm25 import BM25Okapi

        self._entries = entries
        if entries:
            corpus = [_tokenise(entry) for entry in entries]
            self._bm25: "BM25Okapi | None" = BM25Okapi(corpus)
        else:
            self._bm25 = None

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        if self._bm25 is None:
            return []
        tokens = _tokenise_query(query)
        if not tokens:
            return []
        scores = self._bm25.get_scores(tokens)
        ranked = sorted(
            range(len(self._entries)),
            key=lambda i: scores[i],
            reverse=True,
        )
        results = []
        for idx in ranked[:top_k]:
            if scores[idx] <= 0:
                break
            entry = dict(self._entries[idx])
            entry["score"] = float(scores[idx])
            results.append(entry)
        return results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tokenise(entry: dict) -> list[str]:
    """Turn an entry into a bag of lowercase ASCII tokens."""
    parts = [
        entry.get("title", ""),
        entry.get("type", ""),
        " ".join(entry.get("tags", [])),
        entry.get("venue", ""),
        str(entry.get("year", "")),
    ]
    text = " ".join(parts)
    return _split(text)


def _tokenise_query(query: str) -> list[str]:
    return _split(query)


def _split(text: str) -> list[str]:
    # Lower-case, keep alphanumeric + hyphens, split on whitespace/punctuation
    text = text.lower()
    tokens = re.findall(r"[a-z0-9][a-z0-9\-]*", text)
    return tokens or [""]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _load_index() -> BM25Index:
    global _index
    if _index is not None:
        return _index

    if not DATA_FILE.exists():
        _index = BM25Index([])
        return _index

    raw = DATA_FILE.read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(raw)

    entries: list[dict] = []
    for section in ("papers", "books", "sops", "presentations"):
        entries.extend(data.get(section, []))

    _index = BM25Index(entries)
    return _index


def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """Return up to *top_k* entries most relevant to *query*."""
    index = _load_index()
    return index.search(query, top_k=top_k)


def reload() -> None:
    """Force the index to be rebuilt on the next call (call after data rebuild)."""
    global _index
    _index = None
