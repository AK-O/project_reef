def test_register(client):
    resp = client.post("/api/auth/register", json={
        "username": "alice",
        "email": "alice@example.com",
        "password": "secret",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["user"]["username"] == "alice"
    assert "access_token" in data


def test_register_duplicate_username(client, registered_user):
    resp = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "other@example.com",
        "password": "pw",
    })
    assert resp.status_code == 409


def test_login(client, registered_user):
    resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "password123",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_login_wrong_password(client, registered_user):
    resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "wrongpass",
    })
    assert resp.status_code == 401


def test_me(client, registered_user, auth_headers):
    resp = client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["username"] == "testuser"


def test_rotate_api_token(client, registered_user, auth_headers):
    resp = client.post("/api/auth/token", headers=auth_headers)
    assert resp.status_code == 200
    token = resp.json()["api_token"]
    assert len(token) > 10

    # Should be usable for MCP auth
    resp2 = client.get("/api/auth/me", headers={"X-API-Token": token})
    assert resp2.status_code == 200
