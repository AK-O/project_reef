from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Task, User
from nlp import parse_task_input

_FALLBACK_TZ = "Europe/Vienna"

def _user_tz(user: User) -> str:
    """Never pass bare UTC to the NLP parser — use Vienna as fallback."""
    tz = (user.timezone or "").strip()
    return tz if (tz and tz != "UTC") else _FALLBACK_TZ
from schemas import (
    ParsePreview,
    TaskBulkCreate,
    TaskCreate,
    TaskOut,
    TaskReorder,
    TaskUpdate,
)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _get_task_or_404(task_id: str, db: Session) -> Task:
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return t


def _assert_task_access(task: Task, user: User, min_role: str = "viewer"):
    if task.created_by != user.id and task.assigned_to != user.id:
        # check project membership
        if task.project:
            from routers.projects import _assert_access
            _assert_access(task.project, user, min_role)
        else:
            raise HTTPException(status_code=403, detail="Access denied")


@router.get("/inbox", response_model=list[TaskOut])
def get_inbox(
    filter: Optional[str] = Query(None, description="all|today|overdue"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Task).filter(
        Task.created_by == current_user.id,
        Task.project_id.is_(None),
        Task.completed_at.is_(None),
        Task.parent_task_id.is_(None),
    )

    now = datetime.now(timezone.utc)
    if filter == "today":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
        q = q.filter(Task.due_at.between(today_start, today_end))
    elif filter == "overdue":
        q = q.filter(Task.due_at < now, Task.due_at.isnot(None))

    return q.order_by(Task.due_at.asc().nullslast(), Task.created_at.desc()).all()


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: Optional[str] = None,
    bucket_id: Optional[str] = None,
    priority: Optional[str] = None,
    due: Optional[str] = Query(None, description="overdue|today|upcoming"),
    completed: Optional[bool] = None,
    completed_days: Optional[int] = Query(None, description="When completed=true, limit to tasks completed within this many days"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Task).filter(Task.parent_task_id.is_(None))

    # Scope to user's tasks
    from models import ProjectMember
    member_project_ids = [m.project_id for m in current_user.project_memberships]
    q = q.filter(
        (Task.created_by == current_user.id)
        | (Task.assigned_to == current_user.id)
        | (Task.project_id.in_(member_project_ids) if member_project_ids else False)
    )

    if project_id:
        q = q.filter(Task.project_id == project_id)
    if bucket_id:
        q = q.filter(Task.bucket_id == bucket_id)
    if priority:
        q = q.filter(Task.priority == priority)
    if completed is not None:
        if completed:
            q = q.filter(Task.completed_at.isnot(None))
            if completed_days is not None:
                since = datetime.now(timezone.utc) - timedelta(days=completed_days)
                q = q.filter(Task.completed_at >= since)
        else:
            q = q.filter(Task.completed_at.is_(None))

    now = datetime.now(timezone.utc)
    if due == "overdue":
        q = q.filter(Task.due_at < now, Task.due_at.isnot(None), Task.completed_at.is_(None))
    elif due == "today":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = now.replace(hour=23, minute=59, second=59)
        q = q.filter(Task.due_at.between(today_start, today_end))

    return q.order_by(Task.position.asc().nullslast(), Task.due_at.asc().nullslast(), Task.created_at.desc()).all()


@router.post("/parse-preview", response_model=ParsePreview)
def preview_parse(
    body: TaskCreate,
    current_user: User = Depends(get_current_user),
):
    """Preview NLP parsing result before saving — lets UI show parsed time for confirmation."""
    parsed = parse_task_input(body.raw_input, _user_tz(current_user))
    return ParsePreview(
        title=parsed["title"],
        due_at=parsed["due_at"],
        raw_input=body.raw_input,
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.project_id:
        from models import Project as _Project
        from routers.projects import _assert_access
        proj = db.query(_Project).filter(_Project.id == body.project_id).first()
        if proj:
            _assert_access(proj, current_user, "contributor")
    parsed = parse_task_input(body.raw_input, _user_tz(current_user))
    task = Task(
        title=parsed["title"],
        due_at=parsed["due_at"],
        project_id=body.project_id,
        bucket_id=body.bucket_id,
        parent_task_id=body.parent_task_id,
        priority=body.priority,
        assigned_to=body.assigned_to,
        created_by=current_user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/bulk", response_model=list[TaskOut], status_code=status.HTTP_201_CREATED)
def bulk_create(
    body: TaskBulkCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    created = []
    for line in body.lines:
        line = line.strip()
        if not line:
            continue
        parsed = parse_task_input(line, _user_tz(current_user))
        task = Task(
            title=parsed["title"],
            due_at=parsed["due_at"],
            project_id=body.project_id,
            created_by=current_user.id,
        )
        db.add(task)
        created.append(task)
    db.commit()
    for t in created:
        db.refresh(t)
    return [TaskOut.model_validate(t) for t in created]


@router.post("/reorder", status_code=204)
def reorder_tasks(
    body: TaskReorder,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for i, task_id in enumerate(body.task_ids):
        task = db.query(Task).filter(
            Task.id == task_id,
            Task.created_by == current_user.id,
        ).first()
        if task:
            task.position = i * 10
    db.commit()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    _assert_task_access(task, current_user)
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    body: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    _assert_task_access(task, current_user, "contributor")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task, field, value)

    # Reset reminder if due_at changes
    if body.due_at is not None:
        task.reminder_sent = False

    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/{task_id}/complete", response_model=TaskOut)
def complete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    _assert_task_access(task, current_user, "contributor")
    task.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/{task_id}/uncomplete", response_model=TaskOut)
def uncomplete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    _assert_task_access(task, current_user, "contributor")
    task.completed_at = None
    db.commit()
    db.refresh(task)
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(task_id, db)
    if task.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creator can delete a task")
    db.delete(task)
    db.commit()
