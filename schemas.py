from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, EmailStr, field_validator, model_validator


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str
    timezone: str = "Europe/Vienna"
    ha_notify_service: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserUpdate(BaseModel):
    timezone: Optional[str] = None
    ha_notify_service: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    timezone: str
    ha_notify_service: Optional[str]
    api_token: Optional[str]
    is_admin: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class UserAdminUpdate(BaseModel):
    is_admin: Optional[bool] = None
    timezone: Optional[str] = None


class HaConfigUpdate(BaseModel):
    url: Optional[str] = None
    token: Optional[str] = None
    app_url: Optional[str] = None


class ProjectOwnerUpdate(BaseModel):
    owner_id: str


class MigrateTasks(BaseModel):
    to_user_id: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ApiTokenOut(BaseModel):
    api_token: str


# ── Projects ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[str] = None
    color_hue: Optional[int] = None
    icon_seed: Optional[int] = None


class ProjectMemberAdd(BaseModel):
    username: str
    role: str = "contributor"

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("owner", "contributor", "viewer"):
            raise ValueError("role must be owner, contributor, or viewer")
        return v


class ProjectMemberOut(BaseModel):
    user_id: str
    username: str
    role: str

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _resolve_orm(cls, v: Any) -> Any:
        # When Pydantic auto-validates a ProjectMember ORM object (which has no
        # .username directly), extract it from the .user relationship.
        if isinstance(v, dict):
            return v
        if hasattr(v, "user_id") and hasattr(v, "user"):
            return {"user_id": v.user_id, "username": v.user.username, "role": v.role}
        return v


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    parent_id: Optional[str]
    owner_id: str
    archived_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    color_hue: Optional[int] = None
    icon_seed: Optional[int] = None
    sort_order: int = 0
    public_token: Optional[str] = None
    my_role: Optional[str] = None          # "owner" | "contributor" | "viewer"
    members: list["ProjectMemberOut"] = []
    children: list["ProjectOut"] = []

    model_config = {"from_attributes": True}


ProjectOut.model_rebuild()


class MemberRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("owner", "contributor", "viewer"):
            raise ValueError("role must be owner, contributor, or viewer")
        return v


# ── Buckets ───────────────────────────────────────────────────────────────────

class BucketCreate(BaseModel):
    name: str
    position: int = 0


class BucketUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None


class BucketOut(BaseModel):
    id: str
    project_id: str
    name: str
    position: int

    model_config = {"from_attributes": True}


# ── Tasks ─────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    raw_input: str  # goes through NLP
    project_id: Optional[str] = None
    bucket_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    priority: str = "normal"
    assigned_to: Optional[str] = None

    @field_validator("priority")
    @classmethod
    def valid_priority(cls, v: str) -> str:
        if v not in ("high", "normal", "low"):
            raise ValueError("priority must be high, normal, or low")
        return v


class TaskBulkCreate(BaseModel):
    lines: list[str]
    project_id: Optional[str] = None


class TaskReorder(BaseModel):
    task_ids: list[str]


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    project_id: Optional[str] = None
    bucket_id: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    due_at: Optional[datetime] = None
    recurrence: Optional[Any] = None
    position: Optional[int] = None

    @field_validator("priority")
    @classmethod
    def valid_priority(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("high", "normal", "low"):
            raise ValueError("priority must be high, normal, or low")
        return v


class TaskOut(BaseModel):
    id: str
    title: str
    notes: Optional[str]
    project_id: Optional[str]
    bucket_id: Optional[str]
    parent_task_id: Optional[str]
    priority: str
    assigned_to: Optional[str]
    due_at: Optional[datetime]
    reminder_sent: bool
    recurrence: Optional[Any]
    completed_at: Optional[datetime]
    position: Optional[int]
    created_by: str
    created_at: datetime
    updated_at: datetime
    subtasks: list["TaskOut"] = []

    model_config = {"from_attributes": True}


TaskOut.model_rebuild()


class ParsePreview(BaseModel):
    title: str
    due_at: Optional[datetime]
    raw_input: str


# ── Goals ─────────────────────────────────────────────────────────────────────

class GoalCreate(BaseModel):
    title: str
    description: Optional[str] = None


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class GoalOut(BaseModel):
    id: str
    project_id: str
    title: str
    description: Optional[str]
    completed_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Comments ──────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    body: str


class CommentOut(BaseModel):
    id: str
    task_id: str
    user_id: str
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardOut(BaseModel):
    project_id: str
    project_name: str
    open_tasks: int
    completed_tasks: int
    overdue_tasks: int
    goals_total: int
    goals_completed: int
    bucket_distribution: dict[str, int]
    subprojects: list["DashboardOut"] = []

    model_config = {"from_attributes": True}


DashboardOut.model_rebuild()
