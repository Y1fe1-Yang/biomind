"""Tests for admin panel endpoints.

All /api/admin/* endpoints require admin JWT.
Tests monkeypatch file paths to avoid touching real data files.
"""
from __future__ import annotations

import json
import time
import pytest
import jwt as pyjwt
from fastapi.testclient import TestClient
import backend.services.user_store as us_mod
import backend.services.members_store as ms_mod
import backend.services.ai_config_store as acs_mod
import backend.services.data_store as ds_mod
import backend.routers.admin as admin_mod


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def _make_token(username: str, is_admin: bool, secret: str = "test-secret") -> str:
    return pyjwt.encode(
        {"sub": username, "is_admin": is_admin, "exp": time.time() + 3600},
        secret,
        algorithm="HS256",
    )


def _admin_headers(secret: str = "test-secret") -> dict:
    return {"Authorization": f"Bearer {_make_token('admin', True, secret)}"}


def _user_headers(secret: str = "test-secret") -> dict:
    return {"Authorization": f"Bearer {_make_token('regular', False, secret)}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_jwt(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Patch all file-backed stores to use tmp_path
    monkeypatch.setattr(us_mod, "DB_PATH", tmp_path / "users.db")
    monkeypatch.setattr(ms_mod, "MEMBERS_JSON", tmp_path / "members.json")
    monkeypatch.setattr(ms_mod, "MEMBERS_JS", tmp_path / "members.js")
    monkeypatch.setattr(acs_mod, "AI_CONFIG_PATH", tmp_path / "ai_config.json")
    monkeypatch.setattr(ds_mod, "DATA_JSON", tmp_path / "data.json")
    monkeypatch.setattr(ds_mod, "DATA_JS", tmp_path / "data_test.js")
    monkeypatch.setattr(admin_mod, "FOOTER_PATH", tmp_path / "footer_config.json")

    # Seed a minimal data.json so data_store tests have something to search
    (tmp_path / "data.json").write_text(
        json.dumps({
            "papers": [
                {"id": "paper-001", "type": "journal", "title": "Test Paper",
                 "authors": ["Alice"], "year": 2023, "journal": "Test Journal",
                 "doi": "10.0000/test", "file": "papers/test.pdf",
                 "directions": ["biosensing"], "abstract": "Abstract text.",
                 "notes": {"zh": "", "en": ""}},
            ],
            "books": [],
            "sops": [],
            "presentations": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    from backend.main import app
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Auth guard: non-admin gets 403
# ---------------------------------------------------------------------------

class TestAuthGuard:
    def test_members_list_requires_admin(self, client):
        r = client.get("/api/admin/members", headers=_user_headers())
        assert r.status_code == 403

    def test_members_create_requires_admin(self, client):
        r = client.post("/api/admin/members", json={"id": "x"}, headers=_user_headers())
        assert r.status_code == 403

    def test_members_update_requires_admin(self, client):
        r = client.put("/api/admin/members/x", json={}, headers=_user_headers())
        assert r.status_code == 403

    def test_members_delete_requires_admin(self, client):
        r = client.delete("/api/admin/members/x", headers=_user_headers())
        assert r.status_code == 403

    def test_papers_update_requires_admin(self, client):
        r = client.put("/api/admin/papers/x", json={}, headers=_user_headers())
        assert r.status_code == 403

    def test_ai_config_get_requires_admin(self, client):
        r = client.get("/api/admin/ai-config", headers=_user_headers())
        assert r.status_code == 403

    def test_ai_config_put_requires_admin(self, client):
        r = client.put("/api/admin/ai-config", json={}, headers=_user_headers())
        assert r.status_code == 403

    def test_footer_get_requires_admin(self, client):
        r = client.get("/api/admin/footer", headers=_user_headers())
        assert r.status_code == 403

    def test_footer_put_requires_admin(self, client):
        r = client.put("/api/admin/footer", json={"links": []}, headers=_user_headers())
        assert r.status_code == 403

    def test_unauthenticated_returns_401(self, client):
        r = client.get("/api/admin/members")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Members CRUD
# ---------------------------------------------------------------------------

class TestMembersCrud:
    def test_list_members_returns_200_with_list(self, client):
        r = client.get("/api/admin/members", headers=_admin_headers())
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_member(self, client):
        member = {
            "id": "test-member",
            "group": "phd",
            "name": {"zh": "测试", "en": "Test"},
            "title": {"zh": "博士生", "en": "PhD Candidate"},
            "email": "test@siat.ac.cn",
            "photos": [],
            "research": {"zh": [], "en": []},
            "edu": {"zh": [], "en": []},
            "bio": {"zh": "", "en": ""},
        }
        r = client.post("/api/admin/members", json=member, headers=_admin_headers())
        assert r.status_code == 200
        assert r.json()["id"] == "test-member"

    def test_create_member_without_id_returns_400(self, client):
        r = client.post("/api/admin/members", json={"name": "no-id"}, headers=_admin_headers())
        assert r.status_code == 400

    def test_update_member(self, client):
        # First create a member
        member = {"id": "upd-member", "group": "phd", "name": {"zh": "旧名", "en": "Old"}}
        client.post("/api/admin/members", json=member, headers=_admin_headers())

        # Then update
        r = client.put(
            "/api/admin/members/upd-member",
            json={"name": {"zh": "新名", "en": "New"}},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["name"]["en"] == "New"

    def test_update_nonexistent_member_returns_404(self, client):
        r = client.put("/api/admin/members/ghost", json={}, headers=_admin_headers())
        assert r.status_code == 404

    def test_delete_member(self, client):
        member = {"id": "del-member", "group": "phd"}
        client.post("/api/admin/members", json=member, headers=_admin_headers())

        r = client.delete("/api/admin/members/del-member", headers=_admin_headers())
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        # Confirm removed
        members = client.get("/api/admin/members", headers=_admin_headers()).json()
        ids = [m["id"] for m in members]
        assert "del-member" not in ids

    def test_delete_nonexistent_member_returns_404(self, client):
        r = client.delete("/api/admin/members/nobody", headers=_admin_headers())
        assert r.status_code == 404

    def test_create_then_list_roundtrip(self, client):
        m1 = {"id": "m1", "group": "phd"}
        m2 = {"id": "m2", "group": "master"}
        client.post("/api/admin/members", json=m1, headers=_admin_headers())
        client.post("/api/admin/members", json=m2, headers=_admin_headers())

        members = client.get("/api/admin/members", headers=_admin_headers()).json()
        ids = [m["id"] for m in members]
        assert "m1" in ids
        assert "m2" in ids


# ---------------------------------------------------------------------------
# Papers
# ---------------------------------------------------------------------------

class TestPapers:
    def test_update_paper(self, client):
        r = client.put(
            "/api/admin/papers/paper-001",
            json={"title": "Updated Title", "notes": {"zh": "注记", "en": "Note"}},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["title"] == "Updated Title"

    def test_update_nonexistent_paper_returns_404(self, client):
        r = client.put("/api/admin/papers/nope", json={"title": "X"}, headers=_admin_headers())
        assert r.status_code == 404

    def test_update_paper_ignores_disallowed_fields(self, client):
        r = client.put(
            "/api/admin/papers/paper-001",
            json={"title": "Good Title", "type": "HACKED"},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["title"] == "Good Title"
        assert r.json()["type"] == "journal"  # unchanged


# ---------------------------------------------------------------------------
# AI Config
# ---------------------------------------------------------------------------

class TestAiConfig:
    def test_get_ai_config_returns_masked(self, client):
        r = client.get("/api/admin/ai-config", headers=_admin_headers())
        assert r.status_code == 200
        data = r.json()
        assert "provider" in data
        assert "keys" in data

    def test_update_provider(self, client):
        r = client.put(
            "/api/admin/ai-config",
            json={"provider": "claude"},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["provider"] == "claude"

    def test_update_key_shows_masked(self, client):
        r = client.put(
            "/api/admin/ai-config",
            json={"keys": {"zhipu": "mykey12345678"}},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        # Key should be masked
        assert r.json()["keys"]["zhipu"].startswith("****")
        assert r.json()["keys"]["zhipu"].endswith("5678")

    def test_clear_key_shows_empty(self, client):
        # Set a key first
        client.put(
            "/api/admin/ai-config",
            json={"keys": {"zhipu": "mykey12345678"}},
            headers=_admin_headers(),
        )
        # Now clear it
        r = client.put(
            "/api/admin/ai-config",
            json={"keys": {"zhipu": ""}},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["keys"]["zhipu"] == ""

    def test_unspecified_key_is_preserved(self, client, tmp_path, monkeypatch):
        # Set zhipu key
        client.put(
            "/api/admin/ai-config",
            json={"keys": {"zhipu": "zhipukey9999"}},
            headers=_admin_headers(),
        )
        # Update only provider — zhipu key should remain
        r = client.put(
            "/api/admin/ai-config",
            json={"provider": "kimi"},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        # The zhipu key wasn't touched so it's still set (masked)
        assert r.json()["keys"]["zhipu"] != ""


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------

class TestFooter:
    def test_get_footer_returns_links(self, client):
        r = client.get("/api/admin/footer", headers=_admin_headers())
        assert r.status_code == 200
        assert "links" in r.json()

    def test_update_footer(self, client):
        new_links = [{"label": "SIAT", "url": "https://siat.ac.cn"}]
        r = client.put(
            "/api/admin/footer",
            json={"links": new_links},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["links"] == new_links

    def test_get_footer_after_update(self, client):
        links = [{"label": "Lab", "url": "https://lab.example.com"}]
        client.put("/api/admin/footer", json={"links": links}, headers=_admin_headers())

        r = client.get("/api/admin/footer", headers=_admin_headers())
        assert r.status_code == 200
        assert r.json()["links"] == links

    def test_update_footer_missing_links_returns_400(self, client):
        r = client.put(
            "/api/admin/footer",
            json={"bad_key": "value"},
            headers=_admin_headers(),
        )
        assert r.status_code == 400

    def test_update_footer_empty_links(self, client):
        r = client.put(
            "/api/admin/footer",
            json={"links": []},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["links"] == []
