from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Project, Task, User
from routers.projects import _assert_access, _get_project_or_404
from schemas import DashboardOut

router = APIRouter(tags=["dashboard"])


def _build_dashboard(project: Project, db: Session) -> DashboardOut:
    now = datetime.now(timezone.utc)
    all_ids = _collect_ids(project)

    tasks = db.query(Task).filter(Task.project_id.in_(all_ids)).all()
    open_tasks = [t for t in tasks if not t.completed_at]
    completed_tasks = [t for t in tasks if t.completed_at]
    overdue_tasks = [t for t in open_tasks if t.due_at and t.due_at < now]

    goals = project.goals
    goals_completed = [g for g in goals if g.completed_at]

    bucket_dist: dict[str, int] = {}
    for t in open_tasks:
        if t.bucket:
            bucket_dist[t.bucket.name] = bucket_dist.get(t.bucket.name, 0) + 1
        else:
            bucket_dist["Unsorted"] = bucket_dist.get("Unsorted", 0) + 1

    return DashboardOut(
        project_id=project.id,
        project_name=project.name,
        open_tasks=len(open_tasks),
        completed_tasks=len(completed_tasks),
        overdue_tasks=len(overdue_tasks),
        goals_total=len(goals),
        goals_completed=len(goals_completed),
        bucket_distribution=bucket_dist,
        subprojects=[_build_dashboard(c, db) for c in project.children if not c.archived_at],
    )


def _collect_ids(project: Project) -> list[str]:
    ids = [project.id]
    for child in project.children:
        if not child.archived_at:
            ids.extend(_collect_ids(child))
    return ids


@router.get("/api/projects/{project_id}/dashboard", response_model=DashboardOut)
def get_dashboard(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user)
    return _build_dashboard(project, db)
