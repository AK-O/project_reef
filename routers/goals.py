from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Goal, User
from routers.projects import _assert_access, _get_project_or_404
from schemas import GoalCreate, GoalOut, GoalUpdate

router = APIRouter(tags=["goals"])


def _get_goal_or_404(goal_id: str, db: Session) -> Goal:
    g = db.query(Goal).filter(Goal.id == goal_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    return g


@router.get("/api/projects/{project_id}/goals", response_model=list[GoalOut])
def list_goals(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user)
    return project.goals


@router.post(
    "/api/projects/{project_id}/goals",
    response_model=GoalOut,
    status_code=status.HTTP_201_CREATED,
)
def create_goal(
    project_id: str,
    body: GoalCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "contributor")

    goal = Goal(project_id=project_id, title=body.title, description=body.description)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return GoalOut.model_validate(goal)


@router.patch("/api/goals/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: str,
    body: GoalUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = _get_goal_or_404(goal_id, db)
    _assert_access(goal.project, current_user, "contributor")

    if body.title is not None:
        goal.title = body.title
    if body.description is not None:
        goal.description = body.description

    db.commit()
    db.refresh(goal)
    return GoalOut.model_validate(goal)


@router.post("/api/goals/{goal_id}/complete", response_model=GoalOut)
def complete_goal(
    goal_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = _get_goal_or_404(goal_id, db)
    _assert_access(goal.project, current_user, "contributor")
    goal.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(goal)
    return GoalOut.model_validate(goal)
