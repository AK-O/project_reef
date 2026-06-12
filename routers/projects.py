from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Project, ProjectMember, User
from schemas import (
    MemberRoleUpdate,
    ProjectCreate,
    ProjectMemberAdd,
    ProjectMemberOut,
    ProjectOut,
    ProjectUpdate,
)


class _ReorderItem(BaseModel):
    id: str
    sort_order: int

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _assert_access(project: Project, user: User, min_role: str = "viewer"):
    roles = ["viewer", "contributor", "owner"]
    if project.owner_id == user.id:
        return
    member = next((m for m in project.members if m.user_id == user.id), None)
    if not member:
        raise HTTPException(status_code=403, detail="Access denied")
    if roles.index(member.role) < roles.index(min_role):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _get_project_or_404(project_id: str, db: Session) -> Project:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _build_tree(projects: list[Project], parent_id: Optional[str] = None) -> list[ProjectOut]:
    result = []
    for p in sorted(projects, key=lambda x: (x.sort_order, x.created_at)):
        if p.parent_id == parent_id:
            out = ProjectOut.model_validate(p)
            out.children = _build_tree(projects, p.id)
            result.append(out)
    return result


def _set_my_role(out: ProjectOut, project: Project, user_id: str) -> ProjectOut:
    out.my_role = "owner" if project.owner_id == user_id else next(
        (m.role for m in project.members if m.user_id == user_id), None
    )
    out.members = [
        ProjectMemberOut(user_id=m.user_id, username=m.user.username, role=m.role)
        for m in project.members
    ]
    return out


@router.get("", response_model=list[ProjectOut])
def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owned = db.query(Project).filter(
        Project.owner_id == current_user.id,
        Project.archived_at.is_(None),
    ).all()
    member_ids = [m.project_id for m in current_user.project_memberships]
    shared = db.query(Project).filter(
        Project.id.in_(member_ids),
        Project.archived_at.is_(None),
    ).all() if member_ids else []

    all_projects = {p.id: p for p in owned + shared}

    # Build role map
    role_map = {p.id: "owner" for p in owned}
    for m in current_user.project_memberships:
        if m.project_id in all_projects:
            role_map[m.project_id] = m.role

    tree = _build_tree(list(all_projects.values()))

    def _enrich_tree(nodes: list[ProjectOut]):
        for node in nodes:
            p = all_projects.get(node.id)
            if p:
                node.my_role = role_map.get(node.id)
                node.members = [
                    ProjectMemberOut(user_id=m.user_id, username=m.user.username, role=m.role)
                    for m in p.members
                ]
            _enrich_tree(node.children)

    _enrich_tree(tree)
    return tree


@router.get("/archived", response_model=list[ProjectOut])
def list_archived(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Project).filter(
        Project.owner_id == current_user.id,
        Project.archived_at.isnot(None),
    ).all()


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.parent_id:
        parent = _get_project_or_404(body.parent_id, db)
        _assert_access(parent, current_user, "contributor")

    project = Project(
        name=body.name,
        description=body.description,
        parent_id=body.parent_id,
        owner_id=current_user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


@router.post("/reorder", status_code=204)
def reorder_projects(
    body: List[_ReorderItem],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for item in body:
        project = db.query(Project).filter(
            Project.id == item.id,
            Project.owner_id == current_user.id,
        ).first()
        if project:
            project.sort_order = item.sort_order
    db.commit()


@router.get("/public/{public_token}", include_in_schema=True)
def get_public_board(public_token: str, db: Session = Depends(get_db)):
    from models import Task, Bucket  # noqa: F401
    project = db.query(Project).filter(
        Project.public_token == public_token,
        Project.archived_at.is_(None),
    ).first()
    if not project:
        raise HTTPException(404, "Board not found or archived")
    buckets = sorted(project.buckets, key=lambda b: b.position)
    task_list = [t for t in project.tasks if not t.completed_at]
    return {
        "id": project.id,
        "name": project.name,
        "color_hue": project.color_hue,
        "icon_seed": project.icon_seed,
        "buckets": [{"id": b.id, "name": b.name, "position": b.position} for b in buckets],
        "tasks": [
            {
                "id": t.id, "title": t.title, "bucket_id": t.bucket_id,
                "priority": t.priority, "due_at": t.due_at.isoformat() if t.due_at else None,
            }
            for t in task_list
        ],
    }


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user)
    out = ProjectOut.model_validate(project)
    return _set_my_role(out, project, current_user.id)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "contributor")

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    upd = body.model_dump(exclude_unset=True)
    if 'parent_id' in upd:
        project.parent_id = upd['parent_id']
    if 'color_hue' in upd:
        project.color_hue = upd['color_hue']
    if 'icon_seed' in upd:
        project.icon_seed = upd['icon_seed']

    db.commit()
    db.refresh(project)
    out = ProjectOut.model_validate(project)
    return _set_my_role(out, project, current_user.id)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "owner")
    _archive_subtree(project, db)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


def _archive_subtree(project: Project, db: Session):
    now = datetime.now(timezone.utc)
    project.archived_at = now
    for child in project.children:
        _archive_subtree(child, db)


@router.post("/{project_id}/unarchive", response_model=ProjectOut)
def unarchive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "owner")
    _unarchive_subtree(project, db)
    _unarchive_ancestors(project, db)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


def _unarchive_subtree(project: Project, db: Session):
    project.archived_at = None
    for child in project.children:
        _unarchive_subtree(child, db)


def _unarchive_ancestors(project: Project, db: Session):
    if not project.parent_id:
        return
    parent = db.query(Project).filter(Project.id == project.parent_id).first()
    if parent and parent.archived_at is not None:
        parent.archived_at = None
        _unarchive_ancestors(parent, db)


@router.post("/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_member(
    project_id: str,
    body: ProjectMemberAdd,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "owner")

    target = db.query(User).filter(User.username == body.username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(ProjectMember).filter_by(
        project_id=project_id, user_id=target.id
    ).first()
    if existing:
        existing.role = body.role
    else:
        member = ProjectMember(project_id=project_id, user_id=target.id, role=body.role)
        db.add(member)

    db.commit()
    return ProjectMemberOut(user_id=target.id, username=target.username, role=body.role)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "owner")

    member = db.query(ProjectMember).filter_by(
        project_id=project_id, user_id=user_id
    ).first()
    if member:
        db.delete(member)
        db.commit()


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
def list_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user)
    return [
        ProjectMemberOut(user_id=m.user_id, username=m.user.username, role=m.role)
        for m in project.members
    ]


@router.patch("/{project_id}/members/{user_id}", status_code=200)
def update_member_role(
    project_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project_or_404(project_id, db)
    _assert_access(project, current_user, "owner")
    if user_id == current_user.id:
        raise HTTPException(400, "Cannot change your own role (you are the owner)")
    member = db.query(ProjectMember).filter_by(
        project_id=project_id, user_id=user_id
    ).first()
    if not member:
        raise HTTPException(404, "Member not found")
    member.role = body.role
    db.commit()
    return {"ok": True, "role": body.role}
