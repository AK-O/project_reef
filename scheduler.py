"""APScheduler-based reminder delivery via Home Assistant."""

import logging
from datetime import datetime, timedelta, timezone

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

import settings as cfg
from database import SessionLocal
from models import Task, User

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler | None = None


async def _send_ha_notification(service: str, title: str, message: str, project: str) -> bool:
    # Read HA config at call time so runtime changes via the admin panel take effect
    # without a service restart.
    ha_url   = cfg.get_ha_url()
    ha_token = cfg.get_ha_token()

    if not ha_url or not ha_token:
        logger.debug("HA not configured — skipping reminder for '%s'", title)
        return True  # treat as sent so we don't spam logs

    domain, service_name = service.split(".", 1) if "." in service else ("notify", service)
    url = f"{ha_url}/api/services/{domain}/{service_name}"
    headers = {"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"}
    payload = {
        "message": title,
        "title": f"To Do: {title}",
        "data": {"project": project},
    }

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code < 300:
                return True
            logger.warning("HA notify attempt %d failed: %s — %s", attempt + 1, resp.status_code, resp.text)
        except Exception as exc:
            logger.warning("HA notify attempt %d error: %s", attempt + 1, exc)

    return False


async def send_due_reminders():
    """Poll for due tasks and fire HA notifications."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due_tasks = (
            db.query(Task)
            .filter(
                Task.due_at <= now,
                Task.reminder_sent.is_(False),
                Task.completed_at.is_(None),
            )
            .all()
        )

        for task in due_tasks:
            recipient_id = task.assigned_to or task.created_by
            user = db.query(User).filter(User.id == recipient_id).first()
            if not user or not user.ha_notify_service:
                logger.debug("No HA service for task %s — marking sent", task.id)
                task.reminder_sent = True
                continue

            project_name = task.project.name if task.project else "Inbox"
            sent = await _send_ha_notification(
                user.ha_notify_service, task.title, task.title, project_name
            )
            if sent:
                task.reminder_sent = True

        db.commit()
    except Exception as exc:
        logger.error("Reminder job error: %s", exc)
        db.rollback()
    finally:
        db.close()


def _next_due(due_at: datetime, recurrence: dict) -> datetime | None:
    freq = recurrence.get("freq", "weekly")
    interval = int(recurrence.get("interval", 1))
    if freq == "daily":
        return due_at + timedelta(days=interval)
    if freq == "weekly":
        return due_at + timedelta(weeks=interval)
    if freq == "monthly":
        return due_at + relativedelta(months=interval)
    if freq == "yearly":
        return due_at + relativedelta(years=interval)
    return None


async def spawn_recurring_tasks():
    """For each recurring task whose due_at has passed, create the next occurrence (D2)."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        candidates = (
            db.query(Task)
            .filter(
                Task.recurrence.isnot(None),
                Task.due_at.isnot(None),
                Task.due_at <= now,
            )
            .all()
        )
        for task in candidates:
            rec = task.recurrence
            if not rec or rec.get("spawned"):
                continue
            next_due = _next_due(task.due_at, rec)
            if not next_due:
                continue
            db.add(Task(
                title=task.title,
                notes=task.notes,
                project_id=task.project_id,
                bucket_id=task.bucket_id,
                priority=task.priority,
                assigned_to=task.assigned_to,
                created_by=task.created_by,
                due_at=next_due,
                recurrence={k: v for k, v in rec.items() if k != "spawned"},
            ))
            task.recurrence = {**rec, "spawned": True}
        db.commit()
    except Exception as exc:
        logger.error("Recurrence spawn error: %s", exc)
        db.rollback()
    finally:
        db.close()


def start_scheduler():
    global scheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(send_due_reminders,    "interval", seconds=60, id="reminders")
    scheduler.add_job(spawn_recurring_tasks, "interval", seconds=60, id="recurrence")
    scheduler.start()
    logger.info("Reminder scheduler started")


def stop_scheduler():
    global scheduler
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)
    scheduler = None
