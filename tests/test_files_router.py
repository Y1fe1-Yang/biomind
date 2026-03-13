from fastapi.testclient import TestClient
from pathlib import Path
import pytest


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def test_serve_valid_file(tmp_path, monkeypatch):
    # Create a controlled test PDF so this test never skips
    import backend.routers.files as files_mod
    test_root = tmp_path
    (test_root / "files" / "papers").mkdir(parents=True)
    test_pdf = test_root / "files" / "papers" / "test.pdf"
    test_pdf.write_bytes(b"%PDF-1.4 test")
    monkeypatch.setattr(files_mod, "ROOT", test_root)

    from fastapi.testclient import TestClient
    from fastapi import FastAPI
    app2 = FastAPI()
    app2.include_router(files_mod.router)
    client2 = TestClient(app2)
    response = client2.get("/api/files/files/papers/test.pdf")
    assert response.status_code == 200


def test_path_traversal_blocked(client):
    response = client.get("/api/files/../../backend/config.py")
    assert response.status_code in (403, 404)


def test_path_traversal_blocked_encoded(client):
    response = client.get("/api/files/files%2F..%2F..%2Fbackend%2Fconfig.py")
    assert response.status_code in (403, 404)


def test_nonexistent_file_returns_404(client):
    response = client.get("/api/files/files/papers/nonexistent.pdf")
    assert response.status_code == 404
