"""Tests for POST /api/extract-sop SSE endpoint."""
import time
import json
import pytest
import jwt as pyjwt
from fastapi.testclient import TestClient


def _token(username: str, is_admin: bool, secret: str = "test-secret") -> str:
    return pyjwt.encode(
        {"sub": username, "is_admin": is_admin, "exp": time.time() + 3600},
        secret, algorithm="HS256",
    )


@pytest.fixture(autouse=True)
def patch_jwt(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def auth(is_admin: bool = False) -> dict:
    return {"Authorization": f"Bearer {_token('alice', is_admin)}"}


def test_extract_sop_unauthenticated(client):
    resp = client.post("/api/extract-sop", json={"paper_id": "test"})
    assert resp.status_code == 401


def test_extract_sop_non_admin_forbidden(client):
    resp = client.post(
        "/api/extract-sop",
        json={"paper_id": "test"},
        headers=auth(is_admin=False),
    )
    assert resp.status_code == 403


def test_extract_sop_paper_not_found(client, monkeypatch, tmp_path):
    # Patch data.json to have no papers
    import backend.routers.sop_extract as mod
    monkeypatch.setattr(mod, "_ROOT", tmp_path)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "data.json").write_text(
        json.dumps({"meta": {}, "papers": [], "sops": []}), encoding="utf-8"
    )
    resp = client.post(
        "/api/extract-sop",
        json={"paper_id": "nonexistent"},
        headers=auth(is_admin=True),
    )
    assert resp.status_code == 404


def test_extract_sop_success_sse(client, monkeypatch, tmp_path):
    """SSE stream contains progress + done events when extraction succeeds."""
    import backend.routers.sop_extract as mod
    import backend.services.sop_service as svc

    monkeypatch.setattr(mod, "_ROOT", tmp_path)

    # Seed data.json with one paper
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    paper = {
        "id": "labchip2022", "title": "Test Paper", "authors": ["Lin Zeng"],
        "year": 2022, "journal": "Lab on a Chip", "doi": "10.1039/test",
        "file": "1.Journal Articles/test.pdf", "type": "journal",
    }
    (data_dir / "data.json").write_text(
        json.dumps({"meta": {}, "papers": [paper], "sops": []}), encoding="utf-8"
    )

    # Mock the extraction to avoid real API call
    async def fake_extract(paper, root, api_key, existing_sops):
        return [{
            "id": "sop-labchip2022-1", "title": "PDMS Chip", "status": "auto",
            "source_paper_id": "labchip2022", "category": "微流控器件",
            "subcategory": "芯片制备", "steps": ["Step 1"],
        }]
    monkeypatch.setattr(svc, "extract_sop_for_paper", fake_extract)

    # Mock generate_data_files to avoid file scanning
    import scripts.build as build_mod
    monkeypatch.setattr(build_mod, "generate_data_files", lambda **kw: None)

    resp = client.post(
        "/api/extract-sop",
        json={"paper_id": "labchip2022"},
        headers=auth(is_admin=True),
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    events = []
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))

    types = [e["type"] for e in events]
    assert "progress" in types
    assert "done" in types
    done_event = next(e for e in events if e["type"] == "done")
    assert "sop-labchip2022-1" in done_event["sop_ids"]
