# Lab QA Chat Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the BioMiND chat to answer based on actual SOP steps and paper abstracts, citing sources when available and adding a disclaimer when not.

**Architecture:** Two files change. `rag.py` gets a richer BM25 index (abstracts + SOP steps) and a new `retrieve_with_content()` function. `chat.py` gets an upgraded `_build_context()` that passes real content to the AI, plus an updated system prompt that enforces citation rules. No new files, no schema changes, no frontend changes.

**Tech Stack:** Python, rank-bm25, FastAPI, pytest

**Spec:** `docs/superpowers/specs/2026-03-14-lab-qa-upgrade-design.md`

---

## Chunk 1: rag.py — richer index + retrieve_with_content

### File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/services/rag.py` | Add abstract/steps to index; add `retrieve_with_content()` and `_extract_content()` |
| Modify | `tests/test_services.py` | Add 6 new RAG tests |

---

### Task 1: Enrich BM25 index and add retrieve_with_content

**Files:**
- Modify: `backend/services/rag.py`
- Modify: `tests/test_services.py`

Current state of `backend/services/rag.py`:
- `_tokenise(entry)` at line 64 — only indexes title, type, tags, venue, year
- `retrieve(query, top_k)` at line 112 — public API, returns hits without content
- No `retrieve_with_content()` or `_extract_content()` functions exist

- [ ] **Step 1: Write 6 failing tests in `tests/test_services.py`**

Append to the existing RAG section (after `test_rag_top_k_respected`):

```python
def test_rag_indexes_abstract(tmp_path, monkeypatch):
    """BM25 finds papers by keywords that appear only in their abstract."""
    import backend.services.rag as rag_mod

    data = {
        "papers": [
            {"id": "paper-exo", "title": "Unrelated Title", "type": "journal",
             "abstract": "exosome separation by differential ultracentrifugation",
             "tags": [], "year": 2023},
            {"id": "paper-other", "title": "Something Else", "type": "journal",
             "abstract": "photonics and optics", "tags": [], "year": 2022},
        ],
        "books": [], "sops": [], "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve("ultracentrifugation exosome", top_k=5)
    assert len(hits) >= 1
    assert hits[0]["id"] == "paper-exo"


def test_rag_indexes_sop_steps(tmp_path, monkeypatch):
    """BM25 finds SOPs by keywords that appear only in their steps."""
    import backend.services.rag as rag_mod

    data = {
        "papers": [],
        "books": [],
        "sops": [
            {"id": "sop-pdms", "title": "Chip Fabrication", "type": "sop",
             "steps": ["Mix PDMS 10:1 ratio", "Cure at 65°C for 2 hours"],
             "tags": [], "purpose": ""},
        ],
        "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve("PDMS cure temperature", top_k=5)
    assert len(hits) >= 1
    assert hits[0]["id"] == "sop-pdms"


def test_retrieve_with_content_sop_includes_steps(tmp_path, monkeypatch):
    """retrieve_with_content attaches steps text for SOP hits."""
    import backend.services.rag as rag_mod

    data = {
        "papers": [],
        "books": [],
        "sops": [
            {"id": "sop-1", "title": "Protocol", "type": "sop",
             "steps": ["Step A", "Step B", "Step C"],
             "tags": ["protocol"], "purpose": "test"},
        ],
        "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve_with_content("protocol", top_k=5)
    assert len(hits) >= 1
    assert "content" in hits[0]
    assert "Step A" in hits[0]["content"]


def test_retrieve_with_content_paper_includes_abstract(tmp_path, monkeypatch):
    """retrieve_with_content attaches abstract for paper hits."""
    import backend.services.rag as rag_mod

    data = {
        "papers": [
            {"id": "paper-1", "title": "Nano Study", "type": "journal",
             "abstract": "A detailed study of nanoparticles in microfluidics",
             "tags": ["nano"], "year": 2023},
        ],
        "books": [], "sops": [], "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve_with_content("nanoparticles microfluidics", top_k=5)
    assert len(hits) >= 1
    assert "content" in hits[0]
    assert "nanoparticles" in hits[0]["content"]


def test_retrieve_with_content_respects_budget(tmp_path, monkeypatch):
    """Total content across all hits does not exceed 4000 characters."""
    import backend.services.rag as rag_mod

    # 10 SOPs each with a very long steps list
    long_step = "X" * 300
    sops = [
        {"id": f"sop-{i}", "title": f"SOP {i}", "type": "sop",
         "steps": [long_step] * 20, "tags": ["test"], "purpose": ""}
        for i in range(10)
    ]
    data = {"papers": [], "books": [], "sops": sops, "presentations": []}
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve_with_content("SOP test", top_k=10)
    total = sum(len(h.get("content", "")) for h in hits)
    assert total <= 4000


def test_retrieve_with_content_missing_fields(tmp_path, monkeypatch):
    """Missing abstract or steps returns empty content without crashing."""
    import backend.services.rag as rag_mod

    data = {
        "papers": [
            {"id": "paper-noabs", "title": "Paper No Abstract", "type": "journal",
             "tags": ["test"], "year": 2021},
        ],
        "books": [],
        "sops": [
            {"id": "sop-nosteps", "title": "SOP No Steps", "type": "sop",
             "tags": ["test"], "purpose": ""},
        ],
        "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve_with_content("test", top_k=5)
    for h in hits:
        assert "content" in h  # key always present
        assert isinstance(h["content"], str)  # never None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/BioMiND
pytest tests/test_services.py::test_rag_indexes_abstract tests/test_services.py::test_retrieve_with_content_sop_includes_steps -v
```

Expected: FAIL — `AttributeError: module 'backend.services.rag' has no attribute 'retrieve_with_content'` and abstract not yet indexed.

- [ ] **Step 3: Implement changes in `backend/services/rag.py`**

**3a. Update `_tokenise()` (line 64) to include abstracts and SOP steps:**

Replace the existing `_tokenise` function:

```python
def _tokenise(entry: dict) -> list[str]:
    """Turn an entry into a bag of lowercase ASCII tokens."""
    steps_text = " ".join(entry.get("steps", []))
    parts = [
        entry.get("title", ""),
        entry.get("type", ""),
        " ".join(entry.get("tags", [])),
        entry.get("venue", ""),
        str(entry.get("year", "")),
        entry.get("abstract", ""),
        entry.get("purpose", ""),
        steps_text,
    ]
    text = " ".join(parts)
    return _split(text)
```

**3b. Add `_extract_content()` and `retrieve_with_content()` after `retrieve()` (after line 115):**

```python
def _extract_content(entry: dict) -> str:
    """Return the content text to pass to the AI for this entry."""
    if entry.get("type") == "sop":
        steps = entry.get("steps", [])[:8]
        text = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
        return text[:1500]
    return entry.get("abstract", "")[:600]


def retrieve_with_content(query: str, top_k: int = 5) -> list[dict]:
    """
    Like retrieve(), but each hit gains a 'content' key with the actual
    text (SOP steps or paper abstract) to pass to the AI.

    Total content across all returned hits is capped at 4000 characters;
    hits are filled in descending score order until the budget is exhausted.
    """
    hits = retrieve(query, top_k=top_k)
    budget = 4000
    result: list[dict] = []
    for hit in hits:
        if budget <= 0:
            break
        content = _extract_content(hit)[:budget]
        entry = dict(hit)
        entry["content"] = content
        budget -= len(content)
        result.append(entry)
    return result
```

- [ ] **Step 4: Run all 6 new tests to verify they pass**

```bash
pytest tests/test_services.py::test_rag_indexes_abstract \
       tests/test_services.py::test_rag_indexes_sop_steps \
       tests/test_services.py::test_retrieve_with_content_sop_includes_steps \
       tests/test_services.py::test_retrieve_with_content_paper_includes_abstract \
       tests/test_services.py::test_retrieve_with_content_respects_budget \
       tests/test_services.py::test_retrieve_with_content_missing_fields -v
```

Expected: 6 PASS

- [ ] **Step 5: Run full test suite**

```bash
pytest -v
```

Expected: All existing tests still pass (≥49 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/services/rag.py tests/test_services.py
git commit -m "feat: enrich RAG index with abstracts+steps, add retrieve_with_content"
```

---

## Chunk 2: chat.py — richer context + citation system prompt

### File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/routers/chat.py` | Update `_build_context()`, update system prompt, use `retrieve_with_content` |
| Modify | `tests/test_services.py` | Add 4 tests for `_build_context` |

---

### Task 2: Update _build_context and system prompt

**Files:**
- Modify: `backend/routers/chat.py`
- Modify: `tests/test_services.py`

Current state of `backend/routers/chat.py`:
- `SYSTEM_PROMPT` at line 34 — 4-line generic prompt
- `_build_context(hits)` at line 91 — outputs a plain title list
- `chat()` at line 45 — calls `retrieve(req.message, top_k=5)`

- [ ] **Step 1: Write 4 failing tests for `_build_context`**

Append to `tests/test_services.py` (new section after RAG tests):

```python
# ---------------------------------------------------------------------------
# _build_context tests
# ---------------------------------------------------------------------------

def test_build_context_empty_returns_empty():
    from backend.routers.chat import _build_context
    assert _build_context([]) == ""


def test_build_context_sop_shows_steps():
    from backend.routers.chat import _build_context
    hit = {
        "id": "sop-pdms-1", "title": "PDMS Chip Fabrication",
        "type": "sop", "content": "1. Mix PDMS 10:1\n2. Cure at 65°C",
    }
    result = _build_context([hit])
    assert "sop-pdms-1" in result
    assert "步骤" in result
    assert "Mix PDMS" in result


def test_build_context_paper_shows_abstract():
    from backend.routers.chat import _build_context
    hit = {
        "id": "nanoscale2021", "title": "Nano Separation",
        "type": "journal", "content": "A study of magnetic nanoparticles.",
    }
    result = _build_context([hit])
    assert "nanoscale2021" in result
    assert "摘要" in result
    assert "magnetic nanoparticles" in result


def test_build_context_no_content_still_shows_title():
    from backend.routers.chat import _build_context
    hit = {
        "id": "sop-bare", "title": "Bare Protocol",
        "type": "sop", "content": "",
    }
    result = _build_context([hit])
    assert "sop-bare" in result
    assert "Bare Protocol" in result
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_services.py::test_build_context_empty_returns_empty -v
```

Expected: FAIL — `ImportError` or wrong output format.

- [ ] **Step 3: Replace `SYSTEM_PROMPT` and `_build_context` in `backend/routers/chat.py`**

**3a. Replace `SYSTEM_PROMPT` (lines 34–37):**

```python
SYSTEM_PROMPT = """You are the BioMiND lab assistant for a biomedical engineering research group.
You help lab members find papers, understand protocols, draft documents, and answer research questions.
Be concise, precise, and scientific.
Respond in the same language the user writes in (Chinese or English).

Rules:
1. When answering based on the lab resources provided above, cite the source ID in \
parentheses, e.g. "(来源：sop-micromachines2022-1)".
2. When the lab resources do not contain relevant information, start your answer with \
"[通用建议，非实验室记录] " before responding with general knowledge.
3. Never fabricate lab data, protocol parameters, or paper conclusions."""
```

**3b. Replace `_build_context` (lines 91–103):**

```python
_TYPE_LABEL = {
    "sop": "SOP",
    "journal": "论文",
    "conference": "论文",
    "book": "书籍",
    "presentation": "分享",
}


def _build_context(hits: list[dict]) -> str:
    if not hits:
        return ""
    lines = ["以下是实验室相关资料：\n"]
    for h in hits:
        label = _TYPE_LABEL.get(h.get("type", ""), "资料")
        title = h.get("title", "Untitled")
        entry_id = h.get("id", "")
        content = h.get("content", "")

        lines.append(f"[{label}] {title} ({entry_id})")
        if content:
            prefix = "步骤摘要" if h.get("type") == "sop" else "摘要"
            lines.append(f"{prefix}:\n{content}")
        lines.append("")
    return "\n".join(lines)
```

**3c. In `backend/routers/chat.py`, replace the `retrieve` import and call:**

At line 30, replace:
```python
from backend.services.rag import retrieve
```
with:
```python
from backend.services.rag import retrieve_with_content
```

Inside `chat()` (line 60), replace:
```python
hits = retrieve(req.message, top_k=5)
```
with:
```python
hits = retrieve_with_content(req.message, top_k=5)
```

- [ ] **Step 4: Run the 4 new _build_context tests**

```bash
pytest tests/test_services.py::test_build_context_empty_returns_empty \
       tests/test_services.py::test_build_context_sop_shows_steps \
       tests/test_services.py::test_build_context_paper_shows_abstract \
       tests/test_services.py::test_build_context_no_content_still_shows_title -v
```

Expected: 4 PASS

- [ ] **Step 5: Run full test suite**

```bash
pytest -v
```

Expected: All tests pass (≥55 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/routers/chat.py tests/test_services.py
git commit -m "feat: lab_qa — rich RAG context, citation rules, disclaimer system prompt"
```
