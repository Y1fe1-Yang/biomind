"""Tests for /api/sops and /api/admin/sops endpoints."""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import jwt as pyjwt
import pytest
from fastapi.testclient import TestClient


# ── Helpers ────────────────────────────────────────────────────────

def _token(username: str, is_admin: bool, secret: str = "test-secret") -> str:
    return pyjwt.encode(
        {"sub": username, "is_admin": is_admin, "exp": time.time() + 3600},
        secret,
        algorithm="HS256",
    )


def auth(username: str = "alice", is_admin: bool = False) -> dict:
    return {"Authorization": f"Bearer {_token(username, is_admin)}"}


def admin_auth() -> dict:
    return {"Authorization": f"Bearer {_token('admin', True)}"}


# ── Fixtures ───────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_jwt(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture(autouse=True)
def patch_sop_store(tmp_path, monkeypatch):
    """Redirect sop_store to use a tmp file and tmp user-sops dir."""
    import backend.services.sop_store as store
    sops_file = tmp_path / "user-sops.json"
    sops_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(store, "SOPS_PATH", sops_file)
    user_sops_dir = tmp_path / "user-sops"
    user_sops_dir.mkdir()
    monkeypatch.setattr(store, "USER_SOPS_DIR", user_sops_dir)

    # Also patch the router so it uses the tmp dir
    import backend.routers.sops as sops_mod
    monkeypatch.setattr(sops_mod, "USER_SOPS_DIR", user_sops_dir)


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


# ── Tests ──────────────────────────────────────────────────────────

def test_list_sops_unauthenticated(client):
    resp = client.get("/api/sops")
    assert resp.status_code == 401


def test_list_sops_authenticated_empty(client):
    resp = client.get("/api/sops", headers=auth())
    assert resp.status_code == 200
    assert resp.json() == []


def test_upload_sop_markdown(client):
    resp = client.post(
        "/api/sops",
        data={
            "type": "sop",
            "title_zh": "PCR操作规程",
            "title_en": "PCR Protocol",
            "description_zh": "聚合酶链反应操作步骤",
            "description_en": "PCR steps",
            "tags": "PCR,分子生物学",
            "mdContent": "# 步骤\n1. 配置反应体系\n2. PCR扩增",
        },
        headers=auth(),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "sop"
    assert data["title"]["zh"] == "PCR操作规程"
    assert data["fileType"] == "md"
    assert data["mdContent"] == "# 步骤\n1. 配置反应体系\n2. PCR扩增"
    assert data["uploadedBy"] == "alice"
    assert data["status"] == "active"
    assert "PCR" in data["tags"]


def test_upload_share(client):
    resp = client.post(
        "/api/sops",
        data={
            "type": "share",
            "title_zh": "组会文件",
            "mdContent": "本周进展汇报",
        },
        headers=auth(),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "share"


def test_upload_sop_pdf(client, tmp_path):
    # Valid PDF bytes (starts with %PDF)
    pdf_bytes = b"%PDF-1.4 fake pdf content"
    resp = client.post(
        "/api/sops",
        data={
            "type": "sop",
            "title_zh": "PDF规程",
        },
        files={"file": ("protocol.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        headers=auth(),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["fileType"] == "pdf"
    assert data["file"].endswith(".pdf")


def test_upload_sop_invalid_pdf_magic(client):
    """File with .pdf extension but wrong magic bytes should return 400."""
    bad_bytes = b"NOTPDF fake content"
    resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "Bad PDF"},
        files={"file": ("bad.pdf", io.BytesIO(bad_bytes), "application/pdf")},
        headers=auth(),
    )
    assert resp.status_code == 400


def test_upload_sop_no_content(client):
    """Missing both file and mdContent should return 400."""
    resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "空规程"},
        headers=auth(),
    )
    assert resp.status_code == 400


def test_upload_sop_file_too_large(client):
    """File exceeding 20 MB should return 400."""
    big = b"%PDF" + b"x" * (20 * 1024 * 1024 + 1)
    resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "大文件"},
        files={"file": ("big.pdf", io.BytesIO(big), "application/pdf")},
        headers=auth(),
    )
    assert resp.status_code == 400


def test_get_sop(client):
    # Create one first
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "目标SOP", "mdContent": "内容"},
        headers=auth(),
    )
    sop_id = create_resp.json()["id"]

    resp = client.get(f"/api/sops/{sop_id}", headers=auth())
    assert resp.status_code == 200
    assert resp.json()["id"] == sop_id


def test_get_sop_not_found(client):
    resp = client.get("/api/sops/nonexistent-id", headers=auth())
    assert resp.status_code == 404


def test_list_sops_type_filter(client):
    client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "SOP文件", "mdContent": "内容"},
        headers=auth(),
    )
    client.post(
        "/api/sops",
        data={"type": "share", "title_zh": "分享文件", "mdContent": "内容"},
        headers=auth(),
    )

    sop_resp = client.get("/api/sops?type=sop", headers=auth())
    assert sop_resp.status_code == 200
    sops = sop_resp.json()
    assert all(s["type"] == "sop" for s in sops)
    assert len(sops) == 1

    share_resp = client.get("/api/sops?type=share", headers=auth())
    shares = share_resp.json()
    assert all(s["type"] == "share" for s in shares)
    assert len(shares) == 1


def test_edit_sop_owner(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "原始标题", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.put(
        f"/api/sops/{sop_id}",
        json={"title_zh": "新标题", "tags": ["新标签"]},
        headers=auth("alice"),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"]["zh"] == "新标题"
    assert "新标签" in data["tags"]
    assert data["updatedAt"] is not None


def test_edit_sop_non_owner_non_admin_forbidden(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "Alice的SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    # Bob (not owner, not admin) tries to edit
    resp = client.put(
        f"/api/sops/{sop_id}",
        json={"title_zh": "Bob改的标题"},
        headers=auth("bob"),
    )
    assert resp.status_code == 403


def test_edit_sop_admin_can_edit_others(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "Alice的SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.put(
        f"/api/sops/{sop_id}",
        json={"title_zh": "Admin改的标题"},
        headers=admin_auth(),
    )
    assert resp.status_code == 200
    assert resp.json()["title"]["zh"] == "Admin改的标题"


def test_delete_sop_owner(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "待删除SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.delete(f"/api/sops/{sop_id}", headers=auth("alice"))
    assert resp.status_code == 200

    # Should be gone now
    get_resp = client.get(f"/api/sops/{sop_id}", headers=auth("alice"))
    assert get_resp.status_code == 404


def test_delete_sop_non_owner_forbidden(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "Alice的SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.delete(f"/api/sops/{sop_id}", headers=auth("bob"))
    assert resp.status_code == 403


def test_admin_remove_sop(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "要软删除的SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.post(f"/api/admin/sops/{sop_id}/remove", headers=admin_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "removed"

    # Should not appear in list (only active SOPs returned)
    list_resp = client.get("/api/sops", headers=auth())
    sops = list_resp.json()
    assert not any(s["id"] == sop_id for s in sops)


def test_admin_remove_sop_non_admin_forbidden(client):
    create_resp = client.post(
        "/api/sops",
        data={"type": "sop", "title_zh": "SOP", "mdContent": "内容"},
        headers=auth("alice"),
    )
    sop_id = create_resp.json()["id"]

    resp = client.post(
        f"/api/admin/sops/{sop_id}/remove",
        headers=auth("alice", is_admin=False),
    )
    assert resp.status_code == 403
