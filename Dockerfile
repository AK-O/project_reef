# ── Stage 1: build ────────────────────────────────────────────────────────────
# git is only needed here to stamp the version; it never reaches the runtime image.
FROM python:3.12-slim AS build

RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps into an isolated prefix so they can be copied cleanly
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Copy source
COPY . .

# Write VERSION file (use build-arg if provided, else git describe, else "docker")
ARG VERSION=
RUN if [ -n "$VERSION" ]; then \
      echo "$VERSION" > VERSION; \
    elif git describe --tags --always > VERSION 2>/dev/null; then \
      true; \
    else \
      echo "docker" > VERSION; \
    fi

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copy installed packages and binaries from build stage
COPY --from=build /install /usr/local

# Copy application source (including stamped VERSION)
COPY --from=build /app .

# Non-root user
RUN useradd -r -u 1001 -s /bin/false app

# Data directory — SQLite DB lives here at runtime
RUN mkdir -p /data && chown app:app /data
VOLUME /data

ENV DATABASE_URL=sqlite:////data/projectreef.db

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
