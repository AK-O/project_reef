"""Tests for board operations: buckets and task-in-bucket assignment."""


def _make_project(client, headers, name="Board"):
    return client.post("/api/projects", json={"name": name}, headers=headers).json()


def _make_bucket(client, headers, project_id, name="To Do", position=0):
    return client.post(
        f"/api/projects/{project_id}/buckets",
        json={"name": name, "position": position},
        headers=headers,
    ).json()


def test_list_buckets(client, auth_headers):
    proj = _make_project(client, auth_headers)
    _make_bucket(client, auth_headers, proj["id"], "To Do", 0)
    _make_bucket(client, auth_headers, proj["id"], "In Progress", 1)

    resp = client.get(f"/api/projects/{proj['id']}/buckets", headers=auth_headers)
    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()]
    assert "To Do" in names
    assert "In Progress" in names


def test_bucket_update(client, auth_headers):
    proj = _make_project(client, auth_headers)
    bucket = _make_bucket(client, auth_headers, proj["id"])

    resp = client.patch(
        f"/api/buckets/{bucket['id']}",
        json={"name": "Done", "position": 2},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Done"
    assert resp.json()["position"] == 2


def test_bucket_delete(client, auth_headers):
    proj = _make_project(client, auth_headers)
    bucket = _make_bucket(client, auth_headers, proj["id"])

    resp = client.delete(f"/api/buckets/{bucket['id']}", headers=auth_headers)
    assert resp.status_code == 204

    buckets = client.get(f"/api/projects/{proj['id']}/buckets", headers=auth_headers).json()
    assert not any(b["id"] == bucket["id"] for b in buckets)


def test_bucket_delete_moves_tasks_to_unsorted(client, auth_headers):
    proj = _make_project(client, auth_headers)
    bucket = _make_bucket(client, auth_headers, proj["id"])

    task = client.post(
        "/api/tasks",
        json={"raw_input": "Card in bucket", "project_id": proj["id"], "bucket_id": bucket["id"]},
        headers=auth_headers,
    ).json()
    assert task["bucket_id"] == bucket["id"]

    client.delete(f"/api/buckets/{bucket['id']}", headers=auth_headers)

    task_after = client.get(f"/api/tasks/{task['id']}", headers=auth_headers).json()
    assert task_after["bucket_id"] is None


def test_task_in_bucket_filter(client, auth_headers):
    proj = _make_project(client, auth_headers)
    b1 = _make_bucket(client, auth_headers, proj["id"], "Sprint", 0)
    b2 = _make_bucket(client, auth_headers, proj["id"], "Backlog", 1)

    t1 = client.post("/api/tasks", json={"raw_input": "Sprint task", "project_id": proj["id"], "bucket_id": b1["id"]}, headers=auth_headers).json()
    client.post("/api/tasks", json={"raw_input": "Backlog task", "project_id": proj["id"], "bucket_id": b2["id"]}, headers=auth_headers)

    resp = client.get(f"/api/tasks?bucket_id={b1['id']}", headers=auth_headers)
    assert resp.status_code == 200
    ids = [t["id"] for t in resp.json()]
    assert t1["id"] in ids
    assert all(t["bucket_id"] == b1["id"] for t in resp.json())


def test_task_move_between_buckets(client, auth_headers):
    proj = _make_project(client, auth_headers)
    b1 = _make_bucket(client, auth_headers, proj["id"], "Todo", 0)
    b2 = _make_bucket(client, auth_headers, proj["id"], "Done", 1)

    task = client.post("/api/tasks", json={"raw_input": "Move me", "project_id": proj["id"], "bucket_id": b1["id"]}, headers=auth_headers).json()

    resp = client.patch(f"/api/tasks/{task['id']}", json={"bucket_id": b2["id"]}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["bucket_id"] == b2["id"]
