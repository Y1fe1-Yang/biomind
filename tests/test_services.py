"""Tests for RAG and conversation store services."""
import json
import pytest
from pathlib import Path


# ---------------------------------------------------------------------------
# RAG tests
# ---------------------------------------------------------------------------

def test_rag_retrieve_returns_list(tmp_path, monkeypatch):
    import backend.services.rag as rag_mod

    data = {
        "papers": [
            {"id": "paper-mems-2023", "title": "MEMS Fabrication", "type": "journal",
             "file": "files/papers/mems.pdf", "tags": ["MEMS", "fabrication"], "year": 2023},
            {"id": "paper-bio-2022", "title": "Bio Sensors Overview", "type": "journal",
             "file": "files/papers/bio.pdf", "tags": ["biosensor"], "year": 2022},
        ],
        "books": [],
        "sops": [
            {"id": "sop-protocol", "title": "Protocol for MEMS Etching", "type": "sop",
             "file": "files/sops/protocol.pdf", "tags": ["protocol", "etching"]},
        ],
        "presentations": [],
    }
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")

    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve("MEMS fabrication", top_k=3)
    assert isinstance(hits, list)
    assert len(hits) >= 1
    # Top hit should be MEMS-related
    assert "mems" in hits[0]["id"].lower() or "mems" in hits[0]["title"].lower()


def test_rag_retrieve_no_data_returns_empty(tmp_path, monkeypatch):
    import backend.services.rag as rag_mod

    missing = tmp_path / "data" / "data.json"
    monkeypatch.setattr(rag_mod, "DATA_FILE", missing)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve("anything", top_k=5)
    assert hits == []


def test_rag_reload_clears_cache(tmp_path, monkeypatch):
    import backend.services.rag as rag_mod

    monkeypatch.setattr(rag_mod, "_index", object())  # fake cached index
    rag_mod.reload()
    assert rag_mod._index is None


def test_rag_top_k_respected(tmp_path, monkeypatch):
    import backend.services.rag as rag_mod

    entries = [
        {"id": f"paper-{i}", "title": f"Paper about topic {i}", "type": "journal",
         "file": f"files/papers/{i}.pdf", "tags": ["topic"], "year": 2020 + i}
        for i in range(10)
    ]
    data = {"papers": entries, "books": [], "sops": [], "presentations": []}
    data_file = tmp_path / "data" / "data.json"
    data_file.parent.mkdir(parents=True)
    data_file.write_text(json.dumps(data), encoding="utf-8")

    monkeypatch.setattr(rag_mod, "DATA_FILE", data_file)
    monkeypatch.setattr(rag_mod, "_index", None)

    hits = rag_mod.retrieve("topic paper", top_k=3)
    assert len(hits) <= 3


# ---------------------------------------------------------------------------
# Conversation store tests
# ---------------------------------------------------------------------------

def test_conv_save_and_load(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    cs.save_message("alice", "conv1", "user", "Hello")
    cs.save_message("alice", "conv1", "assistant", "Hi there")

    msgs = cs.load_conversation("alice", "conv1")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Hello"
    assert msgs[1]["role"] == "assistant"
    assert "ts" in msgs[0]


def test_conv_list_conversations(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    cs.save_message("bob", "conv-a", "user", "First conversation question")
    cs.save_message("bob", "conv-b", "user", "Second conversation question")

    convs = cs.list_conversations("bob")
    assert len(convs) == 2
    ids = {c["conv_id"] for c in convs}
    assert ids == {"conv-a", "conv-b"}
    # Each has a title derived from first user message
    titles = {c["title"] for c in convs}
    assert any("First" in t for t in titles)


def test_conv_list_empty_user(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    result = cs.list_conversations("nobody")
    assert result == []


def test_conv_load_missing_returns_empty(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    result = cs.load_conversation("alice", "nonexistent")
    assert result == []


def test_conv_delete(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    cs.save_message("carol", "conv-del", "user", "To be deleted")
    assert cs.delete_conversation("carol", "conv-del") is True
    assert cs.load_conversation("carol", "conv-del") == []


def test_conv_delete_nonexistent(tmp_path, monkeypatch):
    import backend.services.conversation_store as cs

    monkeypatch.setattr(cs, "CONV_DIR", tmp_path / "conversations")

    assert cs.delete_conversation("carol", "ghost") is False


def test_conv_new_id_is_unique():
    from backend.services.conversation_store import new_conv_id

    ids = {new_conv_id() for _ in range(100)}
    assert len(ids) == 100


# ---------------------------------------------------------------------------
# RAG enrichment tests (abstracts, SOP steps, retrieve_with_content)
# ---------------------------------------------------------------------------

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
    assert len(hits) < 10  # budget exhaustion must exclude at least one hit


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
        assert h["content"] == ""  # no abstract / no steps → empty string


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
