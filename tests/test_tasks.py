def test_create_task(client, auth_headers):
    resp = client.post("/api/tasks", json={"raw_input": "Buy eggs"}, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Buy eggs"
    assert data["project_id"] is None  # lands in inbox


def test_task_in_inbox(client, auth_headers):
    client.post("/api/tasks", json={"raw_input": "Task in inbox"}, headers=auth_headers)
    resp = client.get("/api/tasks/inbox", headers=auth_headers)
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Task in inbox" in titles


def test_complete_task(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Do laundry"}, headers=auth_headers).json()
    resp = client.post(f"/api/tasks/{t['id']}/complete", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is not None


def test_bulk_create(client, auth_headers):
    resp = client.post("/api/tasks/bulk", json={"lines": ["Task A", "Task B", "Task C"]}, headers=auth_headers)
    assert resp.status_code == 201
    assert len(resp.json()) == 3


def test_bulk_skips_empty_lines(client, auth_headers):
    resp = client.post("/api/tasks/bulk", json={"lines": ["Task A", "", "Task B"]}, headers=auth_headers)
    assert len(resp.json()) == 2


def test_update_task(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Buy milk"}, headers=auth_headers).json()
    resp = client.patch(f"/api/tasks/{t['id']}", json={"title": "Buy oat milk", "priority": "high"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["priority"] == "high"


def test_delete_task(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Temp task"}, headers=auth_headers).json()
    resp = client.delete(f"/api/tasks/{t['id']}", headers=auth_headers)
    assert resp.status_code == 204


def test_parse_preview(client, auth_headers):
    resp = client.post("/api/tasks/parse-preview", json={"raw_input": "Meeting tomorrow 14:00"}, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "Meeting" in data["title"]
    assert data["due_at"] is not None


def test_create_task_with_project(client, auth_headers):
    proj = client.post("/api/projects", json={"name": "Work"}, headers=auth_headers).json()
    resp = client.post("/api/tasks", json={"raw_input": "Write report", "project_id": proj["id"]}, headers=auth_headers)
    assert resp.status_code == 201
    assert resp.json()["project_id"] == proj["id"]


def test_uncomplete_task(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Feed the cat"}, headers=auth_headers).json()
    client.post(f"/api/tasks/{t['id']}/complete", headers=auth_headers)
    resp = client.post(f"/api/tasks/{t['id']}/uncomplete", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["completed_at"] is None


def test_subtask_create(client, auth_headers):
    parent = client.post("/api/tasks", json={"raw_input": "Parent task"}, headers=auth_headers).json()
    child = client.post("/api/tasks", json={"raw_input": "Child task", "parent_task_id": parent["id"]}, headers=auth_headers).json()
    assert child["parent_task_id"] == parent["id"]

    detail = client.get(f"/api/tasks/{parent['id']}", headers=auth_headers).json()
    assert len(detail["subtasks"]) == 1
    assert detail["subtasks"][0]["id"] == child["id"]


def test_task_notes(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Document API"}, headers=auth_headers).json()
    resp = client.patch(f"/api/tasks/{t['id']}", json={"notes": "See confluence page"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["notes"] == "See confluence page"


def test_task_recurrence(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Weekly review"}, headers=auth_headers).json()
    resp = client.patch(f"/api/tasks/{t['id']}", json={"recurrence": {"freq": "weekly", "interval": 1}}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["recurrence"]["freq"] == "weekly"


def test_task_comments(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Refactor auth"}, headers=auth_headers).json()

    add = client.post(f"/api/tasks/{t['id']}/comments", json={"body": "Started on it"}, headers=auth_headers)
    assert add.status_code == 201
    assert add.json()["body"] == "Started on it"

    lst = client.get(f"/api/tasks/{t['id']}/comments", headers=auth_headers)
    assert lst.status_code == 200
    assert len(lst.json()) == 1


def test_list_tasks_priority_filter(client, auth_headers):
    client.post("/api/tasks", json={"raw_input": "High task", "priority": "high"}, headers=auth_headers)
    client.post("/api/tasks", json={"raw_input": "Normal task"}, headers=auth_headers)

    resp = client.get("/api/tasks?priority=high", headers=auth_headers)
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "High task" in titles
    assert "Normal task" not in titles


def test_list_tasks_completed_filter(client, auth_headers):
    t = client.post("/api/tasks", json={"raw_input": "Finish report"}, headers=auth_headers).json()
    client.post(f"/api/tasks/{t['id']}/complete", headers=auth_headers)

    done = client.get("/api/tasks?completed=true", headers=auth_headers).json()
    assert any(task["id"] == t["id"] for task in done)

    open_tasks = client.get("/api/tasks?completed=false", headers=auth_headers).json()
    assert not any(task["id"] == t["id"] for task in open_tasks)


def test_list_tasks_overdue_filter(client, auth_headers):
    from datetime import datetime, timedelta, timezone
    t = client.post("/api/tasks", json={"raw_input": "Overdue task"}, headers=auth_headers).json()
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    client.patch(f"/api/tasks/{t['id']}", json={"due_at": past}, headers=auth_headers)

    resp = client.get("/api/tasks?due=overdue", headers=auth_headers)
    assert resp.status_code == 200
    assert any(task["id"] == t["id"] for task in resp.json())
