from fastapi.testclient import TestClient

def test_health_check():
    from backend.main import app
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
