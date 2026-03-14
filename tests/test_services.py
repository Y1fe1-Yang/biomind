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
