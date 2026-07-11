# ProjectReef

Self-hosted, mobile-first task and project manager for a single homelab user.  
**Core principle:** capture a thought before it disappears, sort it later.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Data Model](#data-model)
5. [NLP Parsing](#nlp-parsing)
6. [Recurrence](#recurrence)
7. [Reminders (Home Assistant)](#reminders-home-assistant)
8. [MCP Server](#mcp-server)
9. [Local Development Setup](#local-development-setup)
10. [Production Setup — Proxmox LXC (manual)](#production-setup--proxmox-lxc)
11. [Production Setup — Docker](#production-setup--docker)
12. [Production Setup — Proxmox (one-command)](#production-setup--proxmox-one-command)
13. [Versioning & Releases](#versioning--releases)
14. [Production Hardening](#production-hardening)
15. [Environment Variables](#environment-variables)
16. [API Overview](#api-overview)
17. [Running Tests](#running-tests)
18. [Roadmap / TODO](#roadmap--todo)

---

## Features

ProjectReef has three pillars:

### 🐦‍⬛ Raven — Tasks
- Quick capture bar with NLP date parsing (German + English)
- Inbox for unsorted tasks; assign to projects later
- Brain dump: paste multiple lines at once to create tasks in bulk
- Filters: due date (today / overdue / none), project, status (open / done / all)
- Sort by due date, priority, or creation time
- Full-text search
- Sub-tasks (unlimited depth)
- Priority levels: high / normal / low
- Recurrence: daily, weekly, monthly, yearly with configurable interval
- Task notes and comments (threaded per task)
- Home Assistant push reminders when a task comes due
- Undo completion (5 s toast window)

### 🦦 Otter — Boards
- Kanban view with custom columns (buckets)
- List view toggle
- Tap-to-move between columns
- Drag-and-drop card reorder within a column
- Quick-add input at the bottom of each column
- Show / hide completed tasks per board
- Board picker in the nav bar — jump to any project's board directly
- Public read-only board link (shareable token URL) with QR code

### 🐙 Octopus — Projects
- Nested project tree (unlimited depth)
- Project tiles with open task count and overdue badge
- Sub-projects shown expanded by default; collapsible
- Drag-and-drop reorder (Edit Order mode)
- Archive / restore projects (archiving cascades to sub-projects; restoring unarchives the full ancestor chain)
- Archive view shows the full tree — active projects as context, archived ones greyed out with a Restore button
- Project settings: rename, change colour / icon seed, move parent, delete
- Sharing with roles: invite other users as `contributor` or `viewer` via a user picker; shared projects are visually badged throughout the UI (project tiles, task-list headers, board picker)
- Owner cascade: sharing a parent project grants the same role on all sub-projects

### Admin panel
- User management: list, promote/demote admin, delete, migrate tasks to another user
- Home Assistant config: set HA URL + token and send a test ping from the UI
- Database maintenance: vacuum, purge completed tasks, purge archived projects
- System stats: user count, task count, project count

### PWA
- Installable on Android and desktop (Add to Home Screen / install prompt)
- Service worker with network-first JS/CSS and offline fallback page
- Mobile-first layout with bottom nav and safe-area handling
- Maskable icon for Android adaptive icon support

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (ORM), SQLite |
| Frontend | Vanilla HTML / CSS / JS (ES modules), no build step |
| Scheduler | APScheduler (in-process, polls every 60 s) |
| NLP | `dateparser` — DE + EN locales, future-biased, DST-safe UTC storage |
| Auth | JWT (user sessions) + per-user `api_token` (MCP) + bcrypt |
| Notifications | Home Assistant REST API |
| MCP Server | Python `mcp` SDK, stdio transport |
| Deployment | systemd on Proxmox LXC · Docker · one-command `deploy/proxmox-create.sh` |

---

## Architecture

```
main.py              FastAPI app — router registration, lifespan, CORS, version detection
database.py          SQLAlchemy engine, session factory, init_db()
models.py            ORM models
auth.py              JWT creation/verification, bcrypt, api_token generation
nlp.py               dateparser wrapper — parse_task_input() → {title, due_at}
scheduler.py         APScheduler — reminder job + recurrence spawn job (60 s interval)
mcp_server.py        Standalone MCP server (stdio), calls the API over the network

deploy/
  install.sh         One-shot installer for Ubuntu 22.04/24.04 LXC (run inside container)
  proxmox-create.sh  Proxmox host helper — creates LXC + runs install.sh end-to-end
  update.sh          In-place updater: git pull → pip sync → service restart
  projectreef.service  Reference systemd unit (install.sh generates this dynamically)

Dockerfile           python:3.12-slim image, /data volume for SQLite
docker-compose.yml   Compose stack with named volume + env file wiring

routers/
  auth.py            POST /auth/register  /login  /me  /token; GET /users
  projects.py        /projects  CRUD, archive, unarchive, reorder, members, public board
  tasks.py           /tasks  CRUD, inbox, complete, uncomplete, bulk, reorder, parse-preview
  buckets.py         /buckets  CRUD, reorder
  goals.py           /goals  CRUD, complete
  dashboard.py       GET /projects/{id}/dashboard  (recursive rollup)
  comments.py        /tasks/{id}/comments  CRUD
  admin.py           /admin  user mgmt, HA config, DB maintenance, stats

static/
  index.html         SPA shell
  css/app.css        All styles
  js/
    app.js           Shell: auth, tab routing, nav, public-board boot
    inbox.js         Tasks tab — quick-add, filters, card rendering, brain dump
    projects.js      Projects tab — grid, board switch, drag-and-drop order, archive
    board.js         Kanban renderer — columns, cards, D&D, public read-only mode
    task-detail.js   Task detail sheet — edit, sub-tasks, comments
    project-settings.js  Project settings sheet — rename, colour, sharing, public link
    admin.js         Admin panel — users, HA config, DB tools
    capture.js       Brain dump / bulk-add sheet
    profile.js       User profile — timezone, HA notify service, API token
    qr-modal.js      QR code overlay for public board links
    slash-picker.js  "/" project picker for quick-add inputs
    api.js           Typed API client (fetch wrappers)
    utils.js         Date formatting, toasts, timezone helpers
    timezones.js     IANA timezone list for the profile selector
    jazzicon.js      Deterministic project avatar generator
  service-worker.js  Network-first SW — JS/CSS always fresh, HTML falls back offline
  manifest.json      PWA manifest
```

### Request flow (web)
```
Browser → FastAPI (JWT via Authorization: Bearer)
                → SQLite (SQLAlchemy ORM)
                → APScheduler (in-process)
                → Home Assistant REST API (reminders)
```

### Request flow (MCP)
```
Claude Desktop → mcp_server.py (stdio)
                       → FastAPI (X-API-Token header)
                              → same SQLite DB
```

---

## Data Model

```
User
├── id, username, email, password_hash
├── timezone (IANA, e.g. "Europe/Vienna")
├── ha_notify_service (e.g. "notify.mobile_app_andreas")
└── api_token (MCP authentication)

Project
├── id, name, description
├── parent_id → Project (self-referential, CASCADE delete)
├── owner_id  → User
├── sort_order (drag-and-drop position within siblings)
├── color_hue, icon_seed (deterministic avatar)
├── archived_at (NULL = active)
└── children → [Project]

Task
├── id, title, notes
├── raw_input (original capture text)
├── project_id → Project (NULL = inbox)
├── bucket_id  → Bucket  (NULL = unsorted)
├── parent_task_id → Task (NULL = top-level)
├── priority: high | normal | low
├── due_at (UTC, timezone-aware)
├── recurrence: JSON {freq, interval} or NULL
├── reminder_sent (bool)
├── completed_at (NULL = open)
├── created_by, assigned_to → User
└── position (column sort order)

Bucket
├── id, name, position
└── project_id → Project

ProjectMember
├── project_id, user_id
└── role: owner | contributor | viewer

Goal
├── id, title, description
├── project_id → Project
├── status: open | done
└── target_date

Comment
├── id, body
├── task_id → Task
└── author_id → User
```

**Key rules:**
- `Task.project_id = NULL` → lives in the Inbox
- `Task.bucket_id = NULL` → unsorted on the board
- Archiving a project cascades to all sub-projects
- Restoring a sub-project automatically restores its full ancestor chain
- Sharing a parent project cascades access to all sub-projects

---

## NLP Parsing

All task input goes through `nlp.py` → `dateparser`.

**Configuration:**
- `PREFER_DATES_FROM = future`
- `TIMEZONE = Europe/Vienna` (overridable via `User.timezone`)
- `RETURN_AS_TIMEZONE_AWARE = True`
- Result always converted to UTC before storage

**Examples:**

| Input | Parsed |
|---|---|
| `Call mom tomorrow 14:00` | title: "Call mom", due: tomorrow 14:00 local → UTC |
| `Steuern morgen 17:00` | title: "Steuern", due: tomorrow 17:00 (German) |
| `Deploy server next Monday` | title: "Deploy server", due: next Monday 00:00 |
| `Buy milk` | title: "Buy milk", due: null |

**Edge cases:**
- Bare time `17:00` → today at 17:00, tomorrow if already past
- Spring-forward gap → shifted to next valid instant
- Fall-back ambiguity → first (pre-transition) occurrence

---

## Recurrence

Recurrence is stored as JSON on the Task: `{"freq": "weekly", "interval": 1}`.

**Supported frequencies:** `daily` · `weekly` · `monthly` · `yearly`  
**Interval:** integer ≥ 1 (e.g. `interval: 2` + `freq: weekly` = every two weeks)

**Behaviour (D2):** when a recurring task's `due_at` passes, the scheduler spawns a **new task** for the next occurrence. The original is marked `spawned: true` in its recurrence JSON so it is not spawned again. The original task is not auto-completed.

The scheduler runs every 60 seconds in-process.

---

## Reminders (Home Assistant)

The scheduler polls every 60 seconds for tasks where:
```
due_at <= now  AND  reminder_sent = False  AND  completed_at IS NULL
```

Reminder is sent to `task.assigned_to`; falls back to `task.created_by`.  
Uses that user's `ha_notify_service` field (e.g. `notify.mobile_app_andreas`).

The HA call posts to:
```
POST {HA_URL}/api/services/notify/{service_name}
Authorization: Bearer {HA_TOKEN}
{
  "message": "<task title>",
  "title": "To Do: <task title>",
  "data": {
    "project": "<project name>",
    "url": "<app_url>/tasks?task=<task_id>",         // iOS companion app
    "clickAction": "<app_url>/tasks?task=<task_id>"  // Android companion app
  }
}
```

The `url`/`clickAction` fields are only included when **App URL** is configured (Admin panel → Home Assistant → App URL, or the `APP_URL` env var). This makes tapping the notification open the task directly in ProjectReef instead of Home Assistant. Leave it blank to keep the companion app's default behaviour.

`reminder_sent` is only set to `True` on HTTP 2xx. Retries up to 3× on failure.  
Set `ha_notify_service` in your user profile inside the app.

---

## MCP Server

The MCP server runs as a separate process launched by Claude Desktop (stdio transport).  
It authenticates to the API using a per-user `api_token` — not a JWT.

### Available tools

| Tool | Description |
|---|---|
| `list_inbox` | List inbox tasks (filter: all / today / overdue) |
| `list_tasks` | List tasks (filter by project, priority, due, completed) |
| `create_task` | Create task via NLP (`raw_input`), supports `project_id`, `priority`, `parent_task_id`, `recurrence` |
| `bulk_create_tasks` | Create multiple tasks from an array of strings |
| `update_task` | Update title, notes, project, priority, bucket, `due_at`, `recurrence` |
| `complete_task` | Mark a task done |
| `uncomplete_task` | Re-open a completed task |
| `delete_task` | Permanently delete a task |
| `add_comment` | Add a comment to a task |
| `list_projects` | List all projects as a tree |
| `get_project` | Get a single project with tasks, goals, buckets |
| `get_dashboard` | Rolled-up metrics for a project and all sub-projects |
| `create_project` | Create a project or sub-project |
| `archive_project` | Archive a project and its sub-tree |
| `list_goals` | List goals for a project |
| `create_goal` | Add a goal to a project |
| `complete_goal` | Mark a goal done |

### Claude Desktop config (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "projectreef": {
      "command": "/opt/projectreef/.venv/bin/python",
      "args": ["/opt/projectreef/mcp_server.py"],
      "env": {
        "PROJECTREEF_URL": "http://<your-lxc-ip>:8000",
        "PROJECTREEF_TOKEN": "<your-api-token>"
      }
    }
  }
}
```

Retrieve your API token from **Profile → API Token** inside the app, or generate one via `POST /auth/token`.

---

## Local Development Setup

### Prerequisites
- Python 3.12+
- Git

### Steps

```bash
# 1. Clone
git clone https://github.com/AK-O/project_reef projectreef
cd projectreef

# 2. Create virtual environment
python -m venv .venv

# 3. Activate it
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Create .env
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY:
python -c "import secrets; print(secrets.token_hex(32))"
# Paste the output as SECRET_KEY in .env

# 6. Start the dev server (auto-reloads on file change)
python -m uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000** — register your first account.

### Home Assistant (optional for local dev)

Leave `HA_URL` and `HA_TOKEN` blank in `.env` to disable reminders. The scheduler still runs but skips silently.

### MCP server (local)

```bash
# In a second terminal, or configure in Claude Desktop:
PROJECTREEF_URL=http://localhost:8000 \
PROJECTREEF_TOKEN=<your-token> \
.venv/bin/python mcp_server.py
```

### Running tests

```bash
# All tests with coverage
.venv/Scripts/pytest tests/ --cov=. --cov-report=term-missing   # Windows
.venv/bin/pytest   tests/ --cov=. --cov-report=term-missing     # Linux/Mac

# Single file
pytest tests/test_nlp.py -v

# Single test
pytest tests/test_nlp.py::test_german_relative -v
```

---

## Production Setup — Proxmox LXC

> **Automated path:** if you want one-command deploy, use [`deploy/proxmox-create.sh`](#production-setup--proxmox-one-command) (Proxmox host) or [`deploy/install.sh`](#production-setup--proxmox-one-command) (inside an existing container). The steps below are the manual equivalent — useful if you have a custom setup or want to understand what the scripts do.

### 1. Create the LXC container

In Proxmox, create an Ubuntu 24.04 container (unprivileged is fine; 22.04 also works):

- **RAM:** 256 MB minimum, 512 MB recommended
- **Disk:** 2 GB minimum
- **Network:** static IP or DHCP reservation recommended

Start the container and open a shell.

### 2. System preparation

```bash
apt update && apt upgrade -y
apt install -y python3.12 python3.12-venv python3.12-dev git
```

> Ubuntu 24.04 ships Python 3.12 in main. On Ubuntu 22.04 it is not in the default repos — add the deadsnakes PPA first:
> ```bash
> apt install -y software-properties-common
> add-apt-repository ppa:deadsnakes/ppa
> apt update && apt install -y python3.12 python3.12-venv python3.12-dev
> ```

### 3. Create the app user and directory

```bash
useradd -r -s /usr/sbin/nologin -d /opt/projectreef projectreef
mkdir -p /opt/projectreef/data
```

### 4. Deploy the application

```bash
# Copy files to the LXC — from your dev machine:
rsync -av --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='data/' \
  /path/to/projectreef/ root@<lxc-ip>:/opt/projectreef/

# Or clone directly inside the LXC:
cd /opt
git clone https://github.com/AK-O/project_reef projectreef
```

### 5. Virtual environment and dependencies

```bash
cd /opt/projectreef
python3.12 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

### 6. Environment file

```bash
cp .env.example .env
nano .env
```

Minimum production `.env`:

```env
SECRET_KEY=<output of: python3 -c "import secrets; print(secrets.token_hex(32))">

DATABASE_URL=sqlite:////opt/projectreef/data/projectreef.db

HA_URL=http://192.168.1.x:8123
HA_TOKEN=<long-lived HA token>

PORT=8000
ALLOWED_ORIGINS=http://<lxc-ip>:8000,https://<tailscale-hostname>
```

### 7. Fix permissions

```bash
chown -R projectreef:projectreef /opt/projectreef
chmod 600 /opt/projectreef/.env
```

### 8. Install the systemd service

```bash
cp /opt/projectreef/deploy/projectreef.service /etc/systemd/system/

systemctl daemon-reload
systemctl enable projectreef
systemctl start projectreef

# Check it started cleanly
systemctl status projectreef
journalctl -u projectreef -f
```

The service file (`deploy/projectreef.service`) uses security hardening flags — `ProtectSystem=strict` with `ReadWritePaths=/opt/projectreef/data` so only the database directory is writable.

### 9. First boot

Open `http://<lxc-ip>:8000` and register your account. Registration stays open after the first account (configurable via D5 in the PRD).

### 10. Tailscale (recommended)

Rather than exposing the port to your LAN directly, install Tailscale in the LXC for a stable private hostname accessible from all your devices:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Update `ALLOWED_ORIGINS` in `.env` to include your Tailscale hostname, then restart:

```bash
systemctl restart projectreef
```

### Updating

```bash
cd /opt/projectreef

# Pull latest code
git pull

# Install any new dependencies
.venv/bin/pip install -r requirements.txt

# Restart (init_db() runs on startup and applies any new columns automatically)
systemctl restart projectreef
```

### Logs

```bash
# Live log
journalctl -u projectreef -f

# Last 100 lines
journalctl -u projectreef -n 100

# Since last boot
journalctl -u projectreef -b
```

### Database backup

The entire state is in a single SQLite file:

```bash
# One-shot backup
cp /opt/projectreef/data/projectreef.db /backup/projectreef-$(date +%Y%m%d).db

# Simple daily cron (add to root crontab: crontab -e)
0 3 * * * cp /opt/projectreef/data/projectreef.db /backup/projectreef-$(date +\%Y\%m\%d).db
```

SQLite WAL mode is enabled, so a plain `cp` is safe while the server is running.

---

## Production Setup — Docker

Docker is the easiest path for non-Proxmox deployments or for running alongside other services with `docker compose`.

### Quick start

```bash
# 1. Generate a secret key
python -c "import secrets; print(secrets.token_hex(32))"

# 2. Create .env (minimum required)
cat > .env <<EOF
SECRET_KEY=<paste key here>
# Optional Home Assistant integration:
# HA_URL=http://192.168.1.x:8123
# HA_TOKEN=<long-lived HA token>
EOF

# 3. Build and start
docker compose up -d

# Open http://localhost:8000
```

The database lives in a named Docker volume (`projectreef-data`) at `/data/projectreef.db`.

### Stamping the version at build time

```bash
# Builds the image and embeds the current git tag into the VERSION file
PROJECTREEF_VERSION=$(git describe --tags --always) docker compose build
```

The version then appears in `GET /health`.

### Updating

```bash
git pull
PROJECTREEF_VERSION=$(git describe --tags --always) docker compose build
docker compose up -d
```

### With Uptime Kuma

Add a new HTTP monitor in Uptime Kuma pointing at `http://<host>:8000/health` — the same machine can run both via `docker compose`:

```yaml
# append to docker-compose.yml
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - uptime-kuma-data:/app/data

volumes:
  uptime-kuma-data:
```

---

## Production Setup — Proxmox (one-command)

Run this on the **Proxmox host** as root — it creates the LXC, installs ProjectReef, and starts the service. No files need to be on the host first.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/AK-O/project_reef/main/deploy/proxmox-create.sh)
```

The script asks for a container root password (the only required prompt) and optionally a git repo URL. Everything else auto-detects or uses sensible defaults: next free container ID ≥ 200, DHCP networking, Ubuntu 24.04, 512 MB RAM, 8 GB disk.

### Fully non-interactive

Pre-set any variable as an env var to skip its prompt entirely:

```bash
CT_IP=192.168.1.50/24  CT_GW=192.168.1.1  CT_PASS=secret \
PR_REPO=https://github.com/AK-O/project_reef \
bash <(curl -fsSL https://raw.githubusercontent.com/AK-O/project_reef/main/deploy/proxmox-create.sh)
```

### Available options

| Variable | Default | Description |
|---|---|---|
| `CTID` | auto (first free ≥ 200) | LXC container ID |
| `CT_HOSTNAME` | `projectreef` | Container hostname |
| `STORAGE` | `local-lvm` | Rootfs storage pool |
| `TPL_STORAGE` | `local` | Template storage |
| `BRIDGE` | `vmbr0` | Proxmox network bridge |
| `CT_IP` | `dhcp` | `192.168.x.x/24` or `dhcp` |
| `CT_GW` | — | Gateway IP (required for static IP) |
| `CT_DNS` | `1.1.1.1 8.8.8.8` | Nameservers, space-separated |
| `CT_RAM` | `512` | Memory in MB |
| `CT_SWAP` | `512` | Swap in MB |
| `CT_DISK` | `8` | Root disk in GB |
| `CT_CORES` | `2` | vCPU count |
| `CT_PASS` | — | Root password — prompted if blank |
| `PR_REPO` | — | Git clone URL; blank = push local files |
| `PR_PORT` | `8000` | App listening port |
| `PR_HA_URL` | — | Home Assistant base URL |
| `PR_HA_TOKEN` | — | Home Assistant long-lived token |
| `PR_EXTRA_ORIGIN` | — | Extra CORS origin or Tailscale hostname |

### What the script does

1. Auto-detects the next free container ID (≥ 200)
2. Downloads Ubuntu 24.04 template if not present (falls back to 22.04)
3. Creates an unprivileged LXC with `nesting=1`, swap, and nameservers configured
4. Waits for the container to boot, then waits for DNS resolution before proceeding
5. Injects a fallback `resolv.conf` automatically if DNS is slow to come up
6. Pushes a properly-quoted config env file into the container
7. Runs `deploy/install.sh` non-interactively (Python 3.12, venv, systemd service)

After completion it prints the container IP and management commands:

```
  Container:       200  (projectreef)
  IP address:      192.168.1.50
  App URL:         http://192.168.1.50:8000

  pct enter 200
  pct exec  200 -- journalctl -u projectreef -f
  pct exec  200 -- bash /opt/projectreef/deploy/update.sh
```

---

## Versioning & Releases

ProjectReef uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

### Git tagging convention

```bash
# Tag a release
git tag v1.1.0
git push origin main --tags
```

| Bump | When |
|---|---|
| **PATCH** | Bug fixes, dependency updates, minor copy changes |
| **MINOR** | New features, backwards-compatible API additions |
| **MAJOR** | Breaking API changes, schema drops, auth overhaul |

### Check the running version

```bash
# Via the API (works everywhere — LXC, Docker, dev)
curl -s http://localhost:8000/health
# → {"status":"ok","version":"v0.3.0"}

# On the LXC directly
cd /opt/projectreef && git describe --tags --always

# In systemd logs
journalctl -u projectreef --since "1 hour ago" | grep "ProjectReef started"
```

`/health` resolves the version by calling `git describe --tags --always` at startup (works on LXC where `.git` is present) or by reading the `VERSION` file written into the Docker image at build time.

### Update workflow

Use the included helper script for all in-place updates:

```bash
sudo bash /opt/projectreef/deploy/update.sh
```

It prints the before/after commit hash, syncs Python dependencies, restarts the service, and confirms it is running. Always run this rather than a raw `git pull` to ensure dependencies stay in sync.

---

## Production Hardening

The default setup (bare uvicorn on a LAN IP) is fine for a single-user homelab. The items below are strongly recommended before exposing the service beyond your LAN.

> **Security headers are set automatically** on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy` (`default-src 'self'`). No proxy config needed for these.

### HTTPS with a reverse proxy

**Caddy** (simplest — automatic TLS if you have a public domain):

```bash
apt install -y caddy
```

`/etc/caddy/Caddyfile`:
```
reef.example.com {
    reverse_proxy localhost:8000
}
```

**nginx** (more control, manual certs or Let's Encrypt via certbot):

```nginx
server {
    listen 443 ssl;
    server_name reef.example.com;

    ssl_certificate     /etc/letsencrypt/live/reef.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reef.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

For a **homelab-only** setup (no public domain), Tailscale + its built-in HTTPS certificates is the easiest path:

```bash
tailscale cert reef.your-tailnet.ts.net
```

Then configure nginx or Caddy to use the cert files from `~/.local/share/tailscale/certs/`.

### Rate limiting on auth endpoints

With nginx, add `limit_req_zone` to prevent brute-force on `/auth/login`:

```nginx
http {
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

    server {
        location /auth/login {
            limit_req zone=auth burst=10 nodelay;
            proxy_pass http://127.0.0.1:8000;
        }
    }
}
```

### fail2ban

Protect against repeated login failures visible in the journal:

```bash
apt install -y fail2ban
```

`/etc/fail2ban/filter.d/projectreef.conf`:
```ini
[Definition]
failregex = .*POST /auth/login.*4[0-9][0-9]
ignoreregex =
```

`/etc/fail2ban/jail.d/projectreef.conf`:
```ini
[projectreef]
enabled  = true
port     = 8000
filter   = projectreef
logpath  = /var/log/journal
maxretry = 10
bantime  = 1h
```

### Database migrations

The current schema evolution uses `ALTER TABLE … ADD COLUMN` statements in `database.py:init_db()`. This is safe for adding columns but not for renames, drops, or type changes.

For future non-trivial migrations, adopt **Alembic**:

```bash
.venv/bin/pip install alembic
.venv/bin/alembic init alembic
# Configure alembic.ini to point at DATABASE_URL from .env
.venv/bin/alembic revision --autogenerate -m "add column x"
.venv/bin/alembic upgrade head
```

Until then: always back up the database before deploying a schema change.

### Automated backups

```bash
# Daily backup cron — add via: crontab -e (as root)
0 3 * * * cp /opt/projectreef/data/projectreef.db \
  /backup/projectreef-$(date +\%Y\%m\%d).db && \
  find /backup -name 'projectreef-*.db' -mtime +30 -delete
```

Keep at least 7–30 days of backups. The SQLite file is small (typically < 10 MB) so storage cost is negligible.

### Health monitoring

The `/health` endpoint returns `{"status": "ok", "version": "<git-tag>"}` and can be polled by any uptime monitor.

**Uptime Kuma** (self-hosted, highly recommended alongside ProjectReef):

1. Add an HTTP monitor pointing at `http://<lxc-ip>:8000/health`
2. Set check interval to 60 s
3. Wire alerts to your Home Assistant notification service — the same one used by ProjectReef reminders

**Systemd watchdog** (simple in-process approach):

The current service file uses `Restart=on-failure`. For an extra layer, add a systemd `OnFailure` service that sends a notification.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **yes** | — | JWT signing secret. Generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | no | `sqlite:///./data/projectreef.db` | SQLAlchemy DB URL. Use an absolute path in production: `sqlite:////opt/projectreef/data/projectreef.db` |
| `HA_URL` | no | — | Home Assistant base URL, e.g. `http://192.168.1.10:8123`. Leave blank to disable reminders |
| `HA_TOKEN` | no | — | HA long-lived access token |
| `APP_URL` | no | — | Public base URL of this ProjectReef instance, e.g. `https://reef.your-tailnet.ts.net`. When set, reminder notifications open the task here instead of in Home Assistant. Also settable at runtime in the admin panel |
| `PORT` | no | `8000` | Listening port (used when running via `python main.py`) |
| `ALLOWED_ORIGINS` | no | `http://localhost:8000` | Comma-separated list of allowed CORS origins |
| `ENABLE_DOCS` | no | `false` | Set to `true` to enable Swagger UI at `/docs` and ReDoc at `/redoc` (disable in production) |

---

## API Overview

Interactive docs available at `http://<host>:8000/docs` (Swagger UI) when the server is running.

### Authentication

```
POST  /auth/register   { username, email, password, timezone }
POST  /auth/login      { username, password }  → { access_token, user }
GET   /auth/me         → current user
PATCH /auth/me         update timezone, ha_notify_service
GET   /auth/users      list all users (for sharing picker; excludes self)
POST  /auth/token      → generate / rotate MCP api_token
```

All protected endpoints require:  
`Authorization: Bearer <jwt>` (web) or `X-API-Token: <api_token>` (MCP)

### Tasks

```
GET    /api/tasks                list (filter: project_id, priority, due, completed)
GET    /api/tasks/inbox          inbox tasks (filter: all | today | overdue)
POST   /api/tasks                create (raw_input → NLP)
POST   /api/tasks/parse-preview  parse without saving → { title, due_at }
POST   /api/tasks/bulk           bulk create from array of strings
POST   /api/tasks/reorder        reorder tasks within a bucket [{ id, position }]
GET    /api/tasks/{id}           get single task
PATCH  /api/tasks/{id}           update (title, notes, project_id, bucket_id, priority, due_at, recurrence)
DELETE /api/tasks/{id}           delete (creator only)
POST   /api/tasks/{id}/complete
POST   /api/tasks/{id}/uncomplete
GET    /api/tasks/{id}/comments
POST   /api/tasks/{id}/comments
DELETE /api/comments/{id}
```

### Projects

```
GET    /api/projects                        list as tree (sorted by sort_order)
GET    /api/projects/archived               list archived (flat)
GET    /api/projects/public/{token}         public read-only board (no auth)
POST   /api/projects                        create
POST   /api/projects/reorder               batch sort_order update [{ id, sort_order }]
GET    /api/projects/{id}
PATCH  /api/projects/{id}                   update (name, description, parent_id, color_hue, icon_seed)
POST   /api/projects/{id}/archive
POST   /api/projects/{id}/unarchive         also restores ancestor chain
GET    /api/projects/{id}/buckets
POST   /api/projects/{id}/buckets
POST   /api/projects/{id}/buckets/reorder   batch position update [{ id, position }]
GET    /api/projects/{id}/goals
POST   /api/projects/{id}/goals
GET    /api/projects/{id}/dashboard
GET    /api/projects/{id}/members
POST   /api/projects/{id}/members           { username, role }
PATCH  /api/projects/{id}/members/{user_id} { role }
DELETE /api/projects/{id}/members/{user_id}
```

### Buckets

```
GET    /api/buckets/{id}
PATCH  /api/buckets/{id}       update (name, position)
DELETE /api/buckets/{id}
```

### Goals

```
PATCH  /api/goals/{id}         update (title, description)
POST   /api/goals/{id}/complete
DELETE /api/goals/{id}
```

### Admin (admin users only)

```
GET    /api/admin/stats
GET    /api/admin/users
PATCH  /api/admin/users/{id}              { is_admin, timezone }
DELETE /api/admin/users/{id}
POST   /api/admin/users/{id}/migrate-tasks  { to_user_id }
GET    /api/admin/projects
PATCH  /api/admin/projects/{id}/owner    { owner_id }
DELETE /api/admin/projects/{id}
GET    /api/admin/ha-config
PATCH  /api/admin/ha-config              { url, token }
POST   /api/admin/ha-ping
POST   /api/admin/vacuum
POST   /api/admin/db/purge-done
POST   /api/admin/db/purge-archived
```

---

## Running Tests

```bash
# All tests
pytest tests/ -v

# With coverage report
pytest tests/ --cov=. --cov-report=term-missing

# NLP tests only
pytest tests/test_nlp.py -v
```

Tests use an in-memory SQLite database and do not require a running server.

---

## Roadmap / TODO

| Feature | Notes |
|---|---|
| **Goals dashboard UI** | Goals exist in the API and MCP. Missing: visual progress on the project page — progress bars, completion rate, timeline. |
| **Offline queue** | Service worker queues `POST /api/tasks` to IndexedDB while offline and replays on reconnect. Needs client-side ID strategy to avoid conflicts on sync. |
| **MCP archive management** | `unarchive_project`, `delete_project`, `update_project` are intentionally absent from MCP today. Add when day-to-day workflows need them. |
| **Alembic migrations** | `init_db()` uses `ALTER TABLE … ADD COLUMN` for schema evolution — safe for additive changes only. Adopt Alembic for renames, drops, or type changes. |


