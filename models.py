import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Boolean, ForeignKey, Integer, String, Text, JSON,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base, UTCDateTime


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    api_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Vienna")
    ha_notify_service: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)

    tasks_created: Mapped[list["Task"]] = relationship(
        "Task", foreign_keys="Task.created_by", back_populates="creator"
    )
    tasks_assigned: Mapped[list["Task"]] = relationship(
        "Task", foreign_keys="Task.assigned_to", back_populates="assignee"
    )
    project_memberships: Mapped[list["ProjectMember"]] = relationship(
        "ProjectMember", back_populates="user"
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)
    color_hue: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    icon_seed: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    public_token: Mapped[str] = mapped_column(String(36), default=_uuid, unique=True, index=True)

    owner: Mapped["User"] = relationship("User")
    parent: Mapped[Optional["Project"]] = relationship(
        "Project", remote_side="Project.id", back_populates="children"
    )
    children: Mapped[list["Project"]] = relationship(
        "Project", back_populates="parent", cascade="all, delete-orphan"
    )
    buckets: Mapped[list["Bucket"]] = relationship(
        "Bucket", back_populates="project", cascade="all, delete-orphan",
        order_by="Bucket.position"
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="project",
        foreign_keys="Task.project_id"
    )
    members: Mapped[list["ProjectMember"]] = relationship(
        "ProjectMember", back_populates="project", cascade="all, delete-orphan"
    )
    goals: Mapped[list["Goal"]] = relationship(
        "Goal", back_populates="project", cascade="all, delete-orphan"
    )


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(20), default="contributor")  # owner/contributor/viewer

    project: Mapped["Project"] = relationship("Project", back_populates="members")
    user: Mapped["User"] = relationship("User", back_populates="project_memberships")


class Bucket(Base):
    __tablename__ = "buckets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped["Project"] = relationship("Project", back_populates="buckets")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="bucket")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    project_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    bucket_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("buckets.id", ondelete="SET NULL"), nullable=True
    )
    parent_task_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True
    )
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # high/normal/low
    assigned_to: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    due_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)

    project: Mapped[Optional["Project"]] = relationship(
        "Project", back_populates="tasks", foreign_keys=[project_id]
    )
    bucket: Mapped[Optional["Bucket"]] = relationship("Bucket", back_populates="tasks")
    creator: Mapped["User"] = relationship(
        "User", foreign_keys=[created_by], back_populates="tasks_created"
    )
    assignee: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[assigned_to], back_populates="tasks_assigned"
    )
    subtasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="parent_task",
        foreign_keys="Task.parent_task_id",
        cascade="all, delete-orphan"
    )
    parent_task: Mapped[Optional["Task"]] = relationship(
        "Task", back_populates="subtasks",
        foreign_keys=[parent_task_id],
        remote_side="Task.id"
    )
    comments: Mapped[list["Comment"]] = relationship(
        "Comment", back_populates="task", cascade="all, delete-orphan",
        order_by="Comment.created_at"
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)

    task: Mapped["Task"] = relationship("Task", back_populates="comments")
    user: Mapped["User"] = relationship("User")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="goals")
