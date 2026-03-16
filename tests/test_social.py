"""Tests for SOP social features: likes, bookmarks, comments.

Auth pattern follows test_conversations_router.py — JWT tokens are minted
directly with pyjwt and the DB is redirected to a tmp_path fixture.
"""
from __future__ import annotations

import json
import time

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient

import backend.services.social_store as ss_mod
import backend.services.user_store as us_mod


# ── Helpers ────────────────────────────────────────────────────────

def _make_token(username: str, is_admin: bool = False, secret: str = "test-secret") -> str:
    return pyjwt.encode(
        {"sub": username, "is_admin": is_admin, "exp": time.time() + 3600},
        secret,
        algorithm="HS256",
    )


def auth(username: str, is_admin: bool = False) -> dict:
    return {"Authorization": f"Bearer {_make_token(username, is_admin)}"}


# ── Fixtures ───────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Redirect both user_store and social_store to a fresh DB in tmp_path."""
    db = tmp_path / "users.db"
    monkeypatch.setattr(us_mod, "DB_PATH", db)
    monkeypatch.setattr(ss_mod, "DB_PATH", db)
    return db


@pytest.fixture
def tmp_sops(tmp_path, monkeypatch):
    """Redirect social_store SOPS_PATH to a fresh user-sops.json in tmp_path."""
    sops_file = tmp_path / "user-sops.json"
    # Seed with one SOP so count updates work
    sops_file.write_text(
        json.dumps([
            {"id": "sop-001", "likeCount": 0, "bookmarkCount": 0, "commentCount": 0},
        ]),
        encoding="utf-8",
    )
    monkeypatch.setattr(ss_mod, "SOPS_PATH", sops_file)
    return sops_file


@pytest.fixture
def client(tmp_db, tmp_sops):
    from backend.main import app
    with TestClient(app) as c:
        yield c


# ── Like tests ─────────────────────────────────────────────────────

def test_like_unauthenticated_returns_401(client):
    resp = client.post("/api/sops/sop-001/like")
    assert resp.status_code == 401


def test_toggle_like_first_call_liked(client):
    resp = client.post("/api/sops/sop-001/like", headers=auth("alice"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["liked"] is True
    assert data["count"] == 1


def test_toggle_like_second_call_unliked(client):
    # First like
    client.post("/api/sops/sop-001/like", headers=auth("alice"))
    # Second like — should toggle off
    resp = client.post("/api/sops/sop-001/like", headers=auth("alice"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["liked"] is False
    assert data["count"] == 0


def test_toggle_like_idempotent_count(client):
    # Two different users like, then one unlikes
    client.post("/api/sops/sop-001/like", headers=auth("alice"))
    client.post("/api/sops/sop-001/like", headers=auth("bob"))
    resp = client.post("/api/sops/sop-001/like", headers=auth("alice"))  # alice unlikes
    data = resp.json()
    assert data["liked"] is False
    assert data["count"] == 1  # bob still likes it


def test_like_updates_sops_json(client, tmp_sops):
    client.post("/api/sops/sop-001/like", headers=auth("alice"))
    sops = json.loads(tmp_sops.read_text(encoding="utf-8"))
    assert sops[0]["likeCount"] == 1


def test_me_likes_returns_sop_ids(client):
    client.post("/api/sops/sop-001/like", headers=auth("alice"))
    client.post("/api/sops/sop-999/like", headers=auth("alice"))
    resp = client.get("/api/me/likes", headers=auth("alice"))
    assert resp.status_code == 200
    ids = resp.json()
    assert "sop-001" in ids
    assert "sop-999" in ids


def test_me_likes_unauthenticated_returns_401(client):
    resp = client.get("/api/me/likes")
    assert resp.status_code == 401


# ── Bookmark tests ─────────────────────────────────────────────────

def test_bookmark_unauthenticated_returns_401(client):
    resp = client.post("/api/sops/sop-001/bookmark")
    assert resp.status_code == 401


def test_toggle_bookmark_first_call_bookmarked(client):
    resp = client.post("/api/sops/sop-001/bookmark", headers=auth("alice"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["bookmarked"] is True
    assert data["count"] == 1


def test_toggle_bookmark_second_call_unbookmarked(client):
    client.post("/api/sops/sop-001/bookmark", headers=auth("alice"))
    resp = client.post("/api/sops/sop-001/bookmark", headers=auth("alice"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["bookmarked"] is False
    assert data["count"] == 0


def test_bookmark_updates_sops_json(client, tmp_sops):
    client.post("/api/sops/sop-001/bookmark", headers=auth("alice"))
    sops = json.loads(tmp_sops.read_text(encoding="utf-8"))
    assert sops[0]["bookmarkCount"] == 1


def test_me_bookmarks_returns_sop_ids(client):
    client.post("/api/sops/sop-001/bookmark", headers=auth("bob"))
    resp = client.get("/api/me/bookmarks", headers=auth("bob"))
    assert resp.status_code == 200
    assert "sop-001" in resp.json()


def test_me_bookmarks_unauthenticated_returns_401(client):
    resp = client.get("/api/me/bookmarks")
    assert resp.status_code == 401


# ── Comment tests ──────────────────────────────────────────────────

def test_post_comment_unauthenticated_returns_401(client):
    resp = client.post("/api/sops/sop-001/comments", json={"content": "hello"})
    assert resp.status_code == 401


def test_post_comment_returns_new_comment(client):
    resp = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Great protocol!"},
        headers=auth("alice"),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "Great protocol!"
    assert data["username"] == "alice"
    assert data["sop_id"] == "sop-001"
    assert "id" in data
    assert "created_at" in data


def test_post_comment_empty_content_returns_400(client):
    resp = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "   "},
        headers=auth("alice"),
    )
    assert resp.status_code == 400


def test_post_comment_too_long_returns_400(client):
    resp = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "x" * 501},
        headers=auth("alice"),
    )
    assert resp.status_code == 400


def test_get_comments_unauthenticated_returns_401(client):
    resp = client.get("/api/sops/sop-001/comments")
    assert resp.status_code == 401


def test_get_comments_includes_posted_comment(client):
    client.post(
        "/api/sops/sop-001/comments",
        json={"content": "First comment"},
        headers=auth("alice"),
    )
    resp = client.get("/api/sops/sop-001/comments", headers=auth("alice"))
    assert resp.status_code == 200
    comments = resp.json()
    assert len(comments) == 1
    assert comments[0]["content"] == "First comment"
    assert comments[0]["username"] == "alice"


def test_get_comments_ordered_by_created_at(client):
    client.post("/api/sops/sop-001/comments", json={"content": "First"}, headers=auth("alice"))
    client.post("/api/sops/sop-001/comments", json={"content": "Second"}, headers=auth("bob"))
    resp = client.get("/api/sops/sop-001/comments", headers=auth("alice"))
    comments = resp.json()
    assert len(comments) == 2
    assert comments[0]["content"] == "First"
    assert comments[1]["content"] == "Second"


def test_comment_updates_sops_json(client, tmp_sops):
    client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Nice SOP"},
        headers=auth("alice"),
    )
    sops = json.loads(tmp_sops.read_text(encoding="utf-8"))
    assert sops[0]["commentCount"] == 1


def test_delete_own_comment(client):
    r = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Delete me"},
        headers=auth("alice"),
    )
    comment_id = r.json()["id"]
    resp = client.delete(
        f"/api/sops/sop-001/comments/{comment_id}",
        headers=auth("alice"),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_delete_own_comment_decrements_count(client, tmp_sops):
    r = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Delete me"},
        headers=auth("alice"),
    )
    comment_id = r.json()["id"]
    client.delete(f"/api/sops/sop-001/comments/{comment_id}", headers=auth("alice"))
    sops = json.loads(tmp_sops.read_text(encoding="utf-8"))
    assert sops[0]["commentCount"] == 0


def test_delete_other_users_comment_as_non_admin_returns_403(client):
    r = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Alice's comment"},
        headers=auth("alice"),
    )
    comment_id = r.json()["id"]
    # Bob (non-admin) tries to delete Alice's comment
    resp = client.delete(
        f"/api/sops/sop-001/comments/{comment_id}",
        headers=auth("bob", is_admin=False),
    )
    assert resp.status_code == 403


def test_delete_other_users_comment_as_admin(client):
    r = client.post(
        "/api/sops/sop-001/comments",
        json={"content": "Alice's comment"},
        headers=auth("alice"),
    )
    comment_id = r.json()["id"]
    # Admin can delete anyone's comment
    resp = client.delete(
        f"/api/sops/sop-001/comments/{comment_id}",
        headers=auth("admin", is_admin=True),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_delete_nonexistent_comment_returns_403(client):
    resp = client.delete(
        "/api/sops/sop-001/comments/99999",
        headers=auth("alice"),
    )
    assert resp.status_code == 403
