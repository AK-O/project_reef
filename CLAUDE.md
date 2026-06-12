# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ProjectReef** is a self-hosted, mobile-first task and project manager built for a single homelab user. The core principle: *capture a thought before it disappears, sort it later*. The PRD (`ProjectReef_PRD_v2.1.docx`) is the authoritative source of truth for all product decisions — read it before making non-trivial design choices.

The product has three pillars (mascots):
- 🐦‍⬛ **Raven** — Tasks: capture, inbox, NLP parsing, reminders
- 🦦 **Otter** — Boards: kanban with custom buckets
- 🐙 **Octopus** — Projects: nested hierarchy, goals, dashboards

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy (ORM), SQLite |
| Frontend | Vanilla HTML/CSS/JS, mobile-first PWA |
| MCP Server | `mcp_server.py` — Python `mcp` SDK, stdio mode |
| Scheduler | APScheduler (in-process, polls every 60s) |
| NLP | `nlp.py` — `dateparser` with DE + EN locales |
| Auth | JWT (user sessions) + per-user `api_token` (MCP) + bcrypt |
| Notifications | Home Assistant REST API |
| Deployment | Bare Python + systemd on Proxmox LXC (Ubuntu 22.04) |

## Development Setup

Always use the virtual environment — never the system Python.

```bash
# First-time setup
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # Linux/Mac

# Run the dev server (auto-reloads on file change)
.venv\Scripts\python -m uvicorn main:app --reload --port 8000

# Run tests
.venv\Scripts\pytest tests\ -v

# Run a single test file / single test
.venv\Scripts\pytest tests/test_nlp.py -v
.venv\Scripts\pytest tests/test_nlp.py::test_german_relative -v

# Run tests with coverage
.venv\Scripts\pytest tests\ --cov=. --cov-report=term-missing

# The MCP server is launched by Claude Desktop, not manually:
# .venv\Scripts\python mcp_server.py
```

## Environment Setup

Copy `.env.example` → `.env` and fill in:

```
SECRET_KEY=<openssl rand -hex 32>
DATABASE_URL=sqlite:////opt/projectreef/data/projectreef.db
HA_URL=http://192.168.x.x:8123
HA_TOKEN=<long-lived HA token>
PORT=8000
ALLOWED_ORIGINS=http://192.168.x.x:8000,https://*.ts.net
```

## Architecture

### Key files (expected layout)
```
main.py              # FastAPI app, router registration
database.py          # SQLAlchemy engine, session, init_db()
models.py            # ORM models (User, Project, Task, Bucket, Goal, Comment)
auth.py              # JWT creation/verification, bcrypt, api_token generation
nlp.py               # dateparser wrapper — parse_task_input() → {title, due_at}
scheduler.py         # APScheduler setup, reminder job
mcp_server.py        # Standalone MCP server (stdio), calls API over LAN
routers/
  auth.py            # POST /auth/register, /login, /me, /token
  projects.py        # /projects CRUD, archive, members
  tasks.py           # /tasks CRUD, inbox, bulk, complete
  buckets.py         # /buckets CRUD
  goals.py           # /goals CRUD
  dashboard.py       # GET /projects/{id}/dashboard (recursive rollup)
static/              # PWA — index.html, JS, CSS, manifest.json, service-worker.js
```

### Data model relationships
- `Task.project_id = NULL` → lives in the user's inbox
- `Task.bucket_id = NULL` → unsorted (not in any kanban column)
- `Task.parent_task_id` → sub-task hierarchy (unlimited depth)
- `Project.parent_id` → nested project tree (unlimited depth)
- `ProjectMember` → join table for sharing (roles: `owner/contributor/viewer`)
- Sharing a parent project cascades access to all subprojects automatically (D1)

### NLP parsing invariants
- All raw input goes through `nlp.py` with `dateparser` configured for `PREFER_DATES_FROM=future`, `TIMEZONE='Europe/Vienna'`, `RETURN_AS_TIMEZONE_AWARE=True`
- Result is converted to UTC before storage — **never store a fixed offset**
- `User.timezone` is an IANA name (e.g. `Europe/Vienna`); use `zoneinfo` to resolve DST against the target date
- A bare time like `17:00` means today's wall-clock 17:00 (tomorrow if already past)
- Spring-forward ambiguity: shift to next valid instant; fall-back ambiguity: use first (pre-transition) occurrence

### Reminder delivery
- APScheduler runs in-process, polls every 60s
- Query: `due_at <= now AND reminder_sent = False AND completed_at IS NULL`
- Reminder goes to `task.assigned_to`; if null, to `task.created_by`
- Uses that user's `ha_notify_service` field (e.g. `notify.mobile_app_andreas`)
- Only sets `reminder_sent = True` on HTTP 200 from HA; retries up to 3× on failure

### MCP server
- Runs as a separate process launched by Claude Desktop (stdio transport)
- Authenticates to the API using a per-user `api_token` (not JWT)
- URL and token from env: `PROJECTREEF_URL`, `PROJECTREEF_TOKEN`
- All task creation goes through the same NLP pipeline as the UI (`POST /tasks` with `raw_input`)

### Authentication
- User sessions: JWT signed with `SECRET_KEY`; passed as `Authorization: Bearer <token>`
- MCP / programmatic access: `api_token` field on `User`, passed as `X-API-Token` header (or equivalent)
- `POST /auth/token` generates/rotates the MCP token

## Feature Phases

Build in this order — do not implement P1/P2 features until Phase 1 exit criteria are met:

- **Phase 0**: Auth, data models, FastAPI skeleton, SQLite, systemd deploy
- **Phase 1 (MVP)**: Quick capture + NLP, inbox, nested projects, kanban (tap-to-move), HA reminders, MCP read/write tools
- **Phase 2**: Brain dump, sub-tasks, priority, recurrence, notes, goals + dashboards, drag-and-drop
- **Phase 3**: Sharing + roles, archive trees, comments/activity, offline queue

## Key Decisions (binding)

| # | Decision |
|---|---|
| D1 | Sharing a parent cascades full access to all subprojects |
| D2 | Recurring tasks spawn next instance on schedule, not on completion |
| D3 | Store UTC; display in user's IANA timezone via `zoneinfo` (DST-safe) |
| D4 | Reminder → assignee; fallback to creator |
| D5 | Registration stays open after first account |

## Non-Goals for v1

File attachments, tags/labels, time tracking, calendar view, public share links, native iOS/Android app, real-time websocket sync.
