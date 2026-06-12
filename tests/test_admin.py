"""Admin endpoint tests — role protection, user mgmt, project mgmt."""
import pytest


def _register(client, username, email="u@test.com"):
    r = client.post("/api/auth/register", json={
        "username": username, "email": email,
        "password": "pass123", "timezone": "UTC",
    })
    assert r.status_code == 201, r.text
    return r.json()


def _hdrs(token):
    return {"Authorization": f"Bearer {token}"}


def test_first_user_is_admin(client):
    data = _register(client, "admin1", "admin1@test.com")
    assert data["user"]["is_admin"] is True


def test_second_user_is_not_admin(client):
    _register(client, "admin1", "admin1@test.com")
    data = _register(client, "user2", "user2@test.com")
    assert data["user"]["is_admin"] is False


def test_admin_can_access_stats(client):
    data = _register(client, "admin1", "admin1@test.com")
    r = client.get("/api/admin/stats", headers=_hdrs(data["access_token"]))
    assert r.status_code == 200
    assert "version" in r.json()
    assert "counts" in r.json()


def test_non_admin_blocked_from_stats(client):
    _register(client, "admin1", "admin1@test.com")
    data = _register(client, "user2", "user2@test.com")
    r = client.get("/api/admin/stats", headers=_hdrs(data["access_token"]))
    assert r.status_code == 403


def test_admin_list_users(client):
    admin = _register(client, "admin1", "admin1@test.com")
    _register(client, "user2", "user2@test.com")
    r = client.get("/api/admin/users", headers=_hdrs(admin["access_token"]))
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_admin_promote_user(client):
    admin = _register(client, "admin1", "admin1@test.com")
    user2 = _register(client, "user2", "user2@test.com")
    r = client.patch(
        f"/api/admin/users/{user2['user']['id']}",
        json={"is_admin": True},
        headers=_hdrs(admin["access_token"]),
    )
    assert r.status_code == 200
    assert r.json()["is_admin"] is True


def test_admin_cannot_demote_self(client):
    admin = _register(client, "admin1", "admin1@test.com")
    r = client.patch(
        f"/api/admin/users/{admin['user']['id']}",
        json={"is_admin": False},
        headers=_hdrs(admin["access_token"]),
    )
    assert r.status_code == 400


def test_admin_delete_user(client):
    admin = _register(client, "admin1", "admin1@test.com")
    user2 = _register(client, "user2", "user2@test.com")
    r = client.delete(
        f"/api/admin/users/{user2['user']['id']}",
        headers=_hdrs(admin["access_token"]),
    )
    assert r.status_code == 200
    users = client.get("/api/admin/users", headers=_hdrs(admin["access_token"])).json()
    assert len(users) == 1


def test_admin_cannot_delete_self(client):
    admin = _register(client, "admin1", "admin1@test.com")
    r = client.delete(
        f"/api/admin/users/{admin['user']['id']}",
        headers=_hdrs(admin["access_token"]),
    )
    assert r.status_code == 400


def test_admin_list_all_projects(client):
    admin = _register(client, "admin1", "admin1@test.com")
    _register(client, "user2", "user2@test.com")
    hdrs = _hdrs(admin["access_token"])
    client.post("/api/projects", json={"name": "P1"}, headers=hdrs)
    r = client.get("/api/admin/projects", headers=hdrs)
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_admin_delete_project(client):
    admin = _register(client, "admin1", "admin1@test.com")
    hdrs = _hdrs(admin["access_token"])
    proj = client.post("/api/projects", json={"name": "DelMe"}, headers=hdrs).json()
    r = client.delete(f"/api/admin/projects/{proj['id']}", headers=hdrs)
    assert r.status_code == 200
    r2 = client.get("/api/admin/projects", headers=hdrs)
    assert not any(p["id"] == proj["id"] for p in r2.json())
