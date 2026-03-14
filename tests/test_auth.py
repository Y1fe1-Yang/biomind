"""Tests for auth endpoints and JWT dependency."""
import pytest
from fastapi.testclient import TestClient
import backend.services.user_store as us_mod


@pytest.fixture(autouse=True)
def patch_db(tmp_path, monkeypatch):
    monkeypatch.setattr(us_mod, "DB_PATH", tmp_path / "users.db")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    import backend.config as cfg
    monkeypatch.setattr(cfg, "JWT_SECRET", "test-secret")


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


def test_register_and_login(client):
    r = client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["username"] == "alice"
    assert data["is_admin"] is True  # first user is admin


def test_second_user_not_admin(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    r = client.post("/api/auth/register", json={"username": "bob", "password": "secret123"})
    assert r.status_code == 200
    assert r.json()["is_admin"] is False


def test_duplicate_username_returns_409(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    r = client.post("/api/auth/register", json={"username": "alice", "password": "other123"})
    assert r.status_code == 409


def test_short_password_returns_400(client):
    r = client.post("/api/auth/register", json={"username": "alice", "password": "hi"})
    assert r.status_code == 400


def test_login_success(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    r = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    r = client.post("/api/auth/login", json={"username": "alice", "password": "wrong"})
    assert r.status_code == 401


def test_me_with_valid_token(client):
    reg = client.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    token = reg.json()["access_token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


def test_me_without_token_returns_401(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_me_with_invalid_token_returns_401(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401
