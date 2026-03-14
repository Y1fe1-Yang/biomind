"""Tests for conversation CRUD endpoints (JWT auth required)."""
import time
import pytest
import jwt as pyjwt
from fastapi.testclient import TestClient
import backend.services.conversation_store as cs_mod


def _make_token(username: str, secret: str = "test-secret") -> str:
    return pyjwt.encode(
        {"sub": username, "is_admin": False, "exp": time.time() + 3600},
        secret,
        algorithm="HS256",
    )


@pytest.fixture(autouse=True)
def patch_jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(cs_mod, "CONV_DIR", tmp_path / "conversations")
    from backend.main import app
    return TestClient(app)


def auth(username: str) -> dict:
    return {"Authorization": f"Bearer {_make_token(username)}"}


def test_list_conversations_empty(client):
    resp = client.get("/api/conversations", headers=auth("nobody"))
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_conversations(client):
    cs_mod.save_message("alice", "c1", "user", "Question one")
    cs_mod.save_message("alice", "c2", "user", "Question two")

    resp = client.get("/api/conversations", headers=auth("alice"))
    assert resp.status_code == 200
    ids = {c["conv_id"] for c in resp.json()}
    assert ids == {"c1", "c2"}


def test_get_conversation(client):
    cs_mod.save_message("bob", "conv-x", "user", "Hello")
    cs_mod.save_message("bob", "conv-x", "assistant", "World")

    resp = client.get("/api/conversations/conv-x", headers=auth("bob"))
    assert resp.status_code == 200
    msgs = resp.json()
    assert len(msgs) == 2


def test_get_conversation_not_found(client):
    resp = client.get("/api/conversations/nope", headers=auth("ghost"))
    assert resp.status_code == 404


def test_delete_conversation(client):
    cs_mod.save_message("carol", "del-me", "user", "Bye")
    resp = client.delete("/api/conversations/del-me", headers=auth("carol"))
    assert resp.status_code == 200
    assert resp.json()["deleted"] == "del-me"


def test_delete_conversation_not_found(client):
    resp = client.delete("/api/conversations/ghost", headers=auth("carol"))
    assert resp.status_code == 404


def test_unauthenticated_returns_401(client):
    resp = client.get("/api/conversations")
    assert resp.status_code == 401


def test_users_cannot_see_each_others_conversations(client):
    cs_mod.save_message("alice", "private", "user", "Alice only")
    # Bob tries to access Alice's conversation by guessing the conv_id
    resp = client.get("/api/conversations/private", headers=auth("bob"))
    assert resp.status_code == 404
