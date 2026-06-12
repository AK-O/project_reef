def test_create_project(client, auth_headers):
    resp = client.post("/api/projects", json={"name": "Homelab"}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "Homelab"


def test_nested_project(client, auth_headers):
    parent = client.post("/api/projects", json={"name": "Homelab"}, headers=auth_headers).json()
    resp = client.post("/api/projects", json={"name": "Proxmox", "parent_id": parent["id"]}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == parent["id"]


def test_list_projects_tree(client, auth_headers):
    parent = client.post("/api/projects", json={"name": "Homelab"}, headers=auth_headers).json()
    client.post("/api/projects", json={"name": "Proxmox", "parent_id": parent["id"]}, headers=auth_headers)
    resp = client.get("/api/projects", headers=auth_headers)
    assert resp.status_code == 200
    projects = resp.json()
    homelab = next(p for p in projects if p["name"] == "Homelab")
    assert len(homelab["children"]) == 1
    assert homelab["children"][0]["name"] == "Proxmox"


def test_archive_project(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "OldProject"}, headers=auth_headers).json()
    resp = client.post(f"/api/projects/{proj['id']}/archive", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["archived_at"] is not None


def test_archived_not_in_active_list(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "ToArchive"}, headers=auth_headers).json()
    client.post(f"/api/projects/{proj['id']}/archive", headers=auth_headers)
    active = client.get("/api/projects", headers=auth_headers).json()
    names = [p["name"] for p in active]
    assert "ToArchive" not in names


def test_create_bucket(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "Work"}, headers=auth_headers).json()
    resp = client.post(f"/api/projects/{proj['id']}/buckets", json={"name": "To Do", "position": 0}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["name"] == "To Do"


def test_dashboard(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "Metrics"}, headers=auth_headers).json()
    client.post("/api/tasks", json={"raw_input": "Task 1", "project_id": proj["id"]}, headers=auth_headers)
    client.post("/api/tasks", json={"raw_input": "Task 2", "project_id": proj["id"]}, headers=auth_headers)
    resp = client.get(f"/api/projects/{proj['id']}/dashboard", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["open_tasks"] == 2


def test_update_project(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "OldName"}, headers=auth_headers).json()
    resp = client.patch(f"/api/projects/{proj['id']}", json={"name": "NewName", "description": "Updated"}, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "NewName"
    assert data["description"] == "Updated"


def test_unarchive_project(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "Comeback"}, headers=auth_headers).json()
    client.post(f"/api/projects/{proj['id']}/archive", headers=auth_headers)

    resp = client.post(f"/api/projects/{proj['id']}/unarchive", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["archived_at"] is None

    active = client.get("/api/projects", headers=auth_headers).json()
    assert any(p["name"] == "Comeback" for p in active)


def test_unarchive_restores_ancestor_chain(client, auth_headers):
    parent = client.post("/api/projects", json={"name": "Root"}, headers=auth_headers).json()
    child = client.post("/api/projects", json={"name": "Child", "parent_id": parent["id"]}, headers=auth_headers).json()

    # Archive the parent — cascades to child
    client.post(f"/api/projects/{parent['id']}/archive", headers=auth_headers)
    archived = client.get("/api/projects/archived", headers=auth_headers).json()
    archived_ids = [p["id"] for p in archived]
    assert parent["id"] in archived_ids
    assert child["id"] in archived_ids

    # Unarchive only the child — should restore parent too
    client.post(f"/api/projects/{child['id']}/unarchive", headers=auth_headers)

    archived_after = client.get("/api/projects/archived", headers=auth_headers).json()
    archived_ids_after = [p["id"] for p in archived_after]
    assert parent["id"] not in archived_ids_after
    assert child["id"] not in archived_ids_after


def test_list_archived(client, auth_headers):
    p1 = client.post("/api/projects", json={"name": "ActiveProject"}, headers=auth_headers).json()
    p2 = client.post("/api/projects", json={"name": "ArchivedProject"}, headers=auth_headers).json()
    client.post(f"/api/projects/{p2['id']}/archive", headers=auth_headers)

    archived = client.get("/api/projects/archived", headers=auth_headers).json()
    archived_names = [p["name"] for p in archived]
    assert "ArchivedProject" in archived_names
    assert "ActiveProject" not in archived_names


def test_reorder_projects(client, auth_headers):
    a = client.post("/api/projects", json={"name": "Alpha"}, headers=auth_headers).json()
    b = client.post("/api/projects", json={"name": "Beta"}, headers=auth_headers).json()

    resp = client.post(
        "/api/projects/reorder",
        json=[{"id": a["id"], "sort_order": 10}, {"id": b["id"], "sort_order": 0}],
        headers=auth_headers,
    )
    assert resp.status_code == 204

    projects = client.get("/api/projects", headers=auth_headers).json()
    names = [p["name"] for p in projects]
    assert names.index("Beta") < names.index("Alpha")
