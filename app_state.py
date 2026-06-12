"""Module-level startup timestamp — imported by routers that need uptime."""
from datetime import datetime, timezone

start_time = datetime.now(timezone.utc)
