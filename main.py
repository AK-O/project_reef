"""ProjectReef — FastAPI application entry point."""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()
import app_state  # noqa: F401 — sets start_time at import
from version import APP_VERSION


def _configure_logging() -> None:
    """Route all stdlib logging through structlog for JSON output to journald."""
    shared_processors = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.stdlib.PositionalArgumentsFormatter(),
    ]
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
        foreign_pre_chain=shared_processors,
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)


_configure_logging()

from database import init_db
from scheduler import start_scheduler, stop_scheduler
from routers import auth, projects, tasks, buckets, goals, dashboard, comments, admin

logger = logging.getLogger(__name__)


_PLACEHOLDER_KEY = "dev-secret-change-in-production"


@asynccontextmanager
async def lifespan(app: FastAPI):
    secret = os.getenv("SECRET_KEY", "")
    if not secret or secret == _PLACEHOLDER_KEY:
        raise RuntimeError(
            "SECRET_KEY is not set or is still the placeholder. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    init_db()
    start_scheduler()
    logger.info("ProjectReef started", extra={"version": APP_VERSION})
    yield
    stop_scheduler()
    logger.info("ProjectReef stopped")


_docs = os.getenv("ENABLE_DOCS", "false").lower() == "true"

app = FastAPI(
    title="ProjectReef API",
    version=APP_VERSION,
    description="Self-hosted task & project manager",
    lifespan=lifespan,
    docs_url="/docs"         if _docs else None,
    redoc_url="/redoc"       if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "   # inline styles still present in modals
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "worker-src 'self'; "
    "manifest-src 'self'; "
    "frame-ancestors 'none'"
)

@app.middleware("http")
async def security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    # Security headers on every response
    response.headers["X-Content-Type-Options"]   = "nosniff"
    response.headers["X-Frame-Options"]          = "DENY"
    response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]       = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"]  = _CSP
    # Never cache JS/CSS so service-worker updates land immediately
    path = request.url.path
    if path.endswith(".js") or path.endswith(".css"):
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"]        = "no-cache"
    return response

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(buckets.router)
app.include_router(goals.router)
app.include_router(dashboard.router)
app.include_router(comments.router)
app.include_router(admin.router)

@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "version": APP_VERSION}


# SPA deep-link routes — serve index.html for each named tab
_index = Path(__file__).parent / "static" / "index.html"

@app.get("/tasks",    include_in_schema=False)
@app.get("/projects", include_in_schema=False)
@app.get("/admin",    include_in_schema=False)
async def spa_tab():
    return FileResponse(_index)

@app.get("/projects/{path:path}", include_in_schema=False)
async def spa_project_deep(path: str):
    return FileResponse(_index)

@app.get("/board/{token}", include_in_schema=False)
async def board_spa(token: str):
    return FileResponse(_index)

# Serve icons from project root (not inside /static/)
icons_dir = Path(__file__).parent / "icons"
if icons_dir.exists():
    app.mount("/icons", StaticFiles(directory=str(icons_dir)), name="icons")

# Serve the PWA — must be mounted last so API routes take precedence
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
