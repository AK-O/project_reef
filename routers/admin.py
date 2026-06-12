"""Admin — health, user management, project management, DB maintenance."""

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

import settings as cfg
from app_state import start_time
from auth import get_admin_user
from version import APP_VERSION
from database import DATABASE_URL, get_db
from models import Bucket, Comment, Goal, Project, Task, User
from schemas import HaConfigUpdate, MigrateTasks, ProjectOwnerUpdate, UserAdminUpdate

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _db_path() -> str | None:
    if not DATABASE_URL.startswith("sqlite"):
        return None
    raw = DATABASE_URL.replace("sqlite:///", "")
    return None if raw.startswith(":") else raw


# ── Health stats ──────────────────────────────────────────────────

@router.get("/stats")
def get_stats(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    uptime_secs = int((datetime.now(timezone.utc) - start_time).total_seconds())

    version = APP_VERSION

    path = _db_path()
    db_size = None
    if path:
        try:
            db_size = os.path.getsize(path)
        except OSError:
            pass

    now = datetime.now(timezone.utc)
    counts = {
        "users":              db.query(User).count(),
        "admins":             db.query(User).filter(User.is_admin.is_(True)).count(),
        "projects_active":    db.query(Project).filter(Project.archived_at.is_(None)).count(),
        "projects_archived":  db.query(Project).filter(Project.archived_at.isnot(None)).count(),
        "tasks_open":         db.query(Task).filter(Task.completed_at.is_(None)).count(),
        "tasks_completed":    db.query(Task).filter(Task.completed_at.isnot(None)).count(),
        "tasks_overdue":      db.query(Task).filter(
            Task.completed_at.is_(None),
            Task.due_at.isnot(None),
            Task.due_at < now,
        ).count(),
        "buckets":            db.query(Bucket).count(),
        "goals_open":         db.query(Goal).filter(Goal.completed_at.is_(None)).count(),
        "goals_completed":    db.query(Goal).filter(Goal.completed_at.isnot(None)).count(),
        "comments":           db.query(Comment).count(),
    }

    return {
        "version":         version,
        "uptime_seconds":  uptime_secs,
        "db": {
            "path":       path or "in-memory",
            "size_bytes": db_size,
            "size_human": _human_size(db_size) if db_size is not None else None,
        },
        "counts": counts,
        "env": {
            "port":            os.getenv("PORT", "8000"),
            "allowed_origins": os.getenv("ALLOWED_ORIGINS", ""),
        },
    }


# ── Home Assistant config ─────────────────────────────────────────

@router.get("/ha-config")
def get_ha_config(current_user: User = Depends(get_admin_user)):
    url   = cfg.get_ha_url()
    token = cfg.get_ha_token()
    return {"url": url, "token_set": bool(token)}


@router.patch("/ha-config")
def update_ha_config(
    body: HaConfigUpdate,
    current_user: User = Depends(get_admin_user),
):
    s = cfg.load()
    if body.url is not None:
        s["ha_url"] = body.url.strip()
    if body.token is not None and body.token.strip():
        s["ha_token"] = body.token.strip()
    cfg.save(s)
    return {"ok": True}


@router.post("/ha-ping")
def ha_ping(current_user: User = Depends(get_admin_user)):
    ha_url   = cfg.get_ha_url()
    ha_token = cfg.get_ha_token()

    if not ha_url or not ha_token:
        return {"ok": False, "error": "HA URL or token not configured"}

    try:
        with httpx.Client(timeout=5) as client:
            resp = client.get(
                f"{ha_url}/api/",
                headers={"Authorization": f"Bearer {ha_token}"},
            )
        if resp.status_code < 300:
            msg = resp.json().get("message", "Connected")
            return {"ok": True, "message": msg}
        return {"ok": False, "error": f"HTTP {resp.status_code}"}
    except httpx.ConnectError:
        return {"ok": False, "error": "Connection refused — check URL"}
    except httpx.TimeoutException:
        return {"ok": False, "error": "Timed out after 5 s"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── DB maintenance ────────────────────────────────────────────────

@router.post("/vacuum")
def vacuum_db(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    db.execute(text("VACUUM"))
    db.commit()
    return {"ok": True}


@router.post("/db/purge-done")
def purge_done_tasks(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    deleted = db.query(Task).filter(Task.completed_at.isnot(None)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@router.post("/db/purge-archived")
def purge_archived_projects(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    archived = db.query(Project).filter(Project.archived_at.isnot(None)).all()
    count = len(archived)
    for p in archived:
        db.delete(p)
    db.commit()
    return {"deleted": count}


# ── User management ───────────────────────────────────────────────

@router.get("/users")
def list_users(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.created_at).all()
    now = datetime.now(timezone.utc)
    result = []
    for u in users:
        open_tasks = db.query(Task).filter(Task.created_by == u.id, Task.completed_at.is_(None)).count()
        overdue    = db.query(Task).filter(
            Task.created_by == u.id,
            Task.completed_at.is_(None),
            Task.due_at.isnot(None),
            Task.due_at < now,
        ).count()
        projects = db.query(Project).filter(Project.owner_id == u.id, Project.archived_at.is_(None)).count()
        result.append({
            "id":         u.id,
            "username":   u.username,
            "email":      u.email,
            "is_admin":   u.is_admin,
            "timezone":   u.timezone,
            "created_at": u.created_at.isoformat(),
            "open_tasks": open_tasks,
            "overdue":    overdue,
            "projects":   projects,
        })
    return result


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    body: UserAdminUpdate,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id and body.is_admin is False:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.timezone is not None:
        user.timezone = body.timezone
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete owned projects first (FK cascades to buckets, goals, members;
    # tasks in those projects get project_id = NULL via SET NULL cascade)
    db.execute(text("DELETE FROM projects WHERE owner_id = :uid"), {"uid": user_id})
    # Delete user row (FK cascades: tasks created_by, comments, memberships)
    db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/migrate-tasks")
def migrate_tasks(
    user_id: str,
    body: MigrateTasks,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    if user_id == body.to_user_id:
        raise HTTPException(status_code=400, detail="Source and target user are the same")
    target = db.query(User).filter(User.id == body.to_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")
    moved = db.query(Task).filter(Task.created_by == user_id).update(
        {"created_by": body.to_user_id}, synchronize_session=False
    )
    db.commit()
    return {"moved": moved}


# ── Project management ────────────────────────────────────────────

@router.get("/projects")
def list_all_projects(
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    result = []
    for p in projects:
        owner      = db.query(User).filter(User.id == p.owner_id).first()
        open_tasks = db.query(Task).filter(Task.project_id == p.id, Task.completed_at.is_(None)).count()
        result.append({
            "id":         p.id,
            "name":       p.name,
            "owner":      owner.username if owner else "—",
            "owner_id":   p.owner_id,
            "open_tasks": open_tasks,
            "archived":   p.archived_at is not None,
            "created_at": p.created_at.isoformat(),
        })
    return result


@router.patch("/projects/{project_id}/owner")
def change_project_owner(
    project_id: str,
    body: ProjectOwnerUpdate,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    new_owner = db.query(User).filter(User.id == body.owner_id).first()
    if not new_owner:
        raise HTTPException(status_code=404, detail="New owner not found")
    project.owner_id = body.owner_id
    db.commit()
    return {"ok": True, "owner": new_owner.username}


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}
