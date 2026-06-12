"""Tests for goal CRUD and completion."""


def _make_project(client, headers, name="Goals Project"):
    return client.post("/api/projects", json={"name": name}, headers=headers).json()


def test_create_goal(client, auth_headers):
    proj = _make_project(client, auth_headers)
    resp = client.post(
        f"/api/projects/{proj['id']}/goals",
        json={"title": "Ship v1.0", "description": "First public release"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Ship v1.0"
    assert data["description"] == "First public release"
    assert data["completed_at"] is None
    assert data["project_id"] == proj["id"]


def test_list_goals(client, auth_headers):
    proj = _make_project(client, auth_headers)
    client.post(f"/api/projects/{proj['id']}/goals", json={"title": "Goal A"}, headers=auth_headers)
    client.post(f"/api/projects/{proj['id']}/goals", json={"title": "Goal B"}, headers=auth_headers)

    resp = client.get(f"/api/projects/{proj['id']}/goals", headers=auth_headers)
    assert resp.status_code == 200
    titles = [g["title"] for g in resp.json()]
    assert "Goal A" in titles
    assert "Goal B" in titles


def test_complete_goal(client, auth_headers):
    proj = _make_project(client, auth_headers)
    goal = client.post(f"/api/projects/{proj['id']}/goals", json={"title": "Finish tests"}, headers=auth_headers).json()

    resp = client.post(f"/api/goals/{goal['id']}/complete", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is not None


def test_update_goal(client, auth_headers):
    proj = _make_project(client, auth_headers)
    goal = client.post(f"/api/projects/{proj['id']}/goals", json={"title": "Old title"}, headers=auth_headers).json()

    resp = client.patch(
        f"/api/goals/{goal['id']}",
        json={"title": "New title", "description": "Added description"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "New title"
    assert resp.json()["description"] == "Added description"


def test_goals_isolated_per_project(client, auth_headers):
    p1 = _make_project(client, auth_headers, "P1")
    p2 = _make_project(client, auth_headers, "P2")
    client.post(f"/api/projects/{p1['id']}/goals", json={"title": "P1 Goal"}, headers=auth_headers)

    resp = client.get(f"/api/projects/{p2['id']}/goals", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []
