"""NLP date/time extraction from raw task input.

Uses dateparser with DE + EN locales. Stores in UTC; display in user's
IANA timezone (resolved via zoneinfo so DST is handled automatically).
"""

import re
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import dateparser
from dateparser.search import search_dates


_PARSER_SETTINGS_TEMPLATE = {
    "PREFER_DATES_FROM": "future",
    "RETURN_AS_TIMEZONE_AWARE": True,
    "PREFER_DAY_OF_MONTH": "first",
}

_LANGUAGES = ["de", "en"]


def parse_task_input(
    raw: str,
    user_timezone: str = "Europe/Vienna",
) -> dict:
    """Extract title and due_at (UTC) from raw task text.

    Returns {"title": str, "due_at": datetime | None}
    due_at is always UTC-aware when set.
    """
    raw = raw.strip()
    if not raw:
        return {"title": "", "due_at": None}

    settings = {**_PARSER_SETTINGS_TEMPLATE, "TIMEZONE": user_timezone}

    # Search for date/time expressions within the text
    results = search_dates(raw, languages=_LANGUAGES, settings=settings)

    if not results:
        return {"title": raw, "due_at": None}

    # Use the last found date expression (most commonly the one at the end)
    date_str, parsed_dt = results[-1]

    # Build clean title by removing the date expression
    title = raw.replace(date_str, "").strip()
    # Collapse multiple spaces
    title = re.sub(r"\s{2,}", " ", title).strip()

    if not title:
        title = raw  # guard: don't produce empty title

    # Convert to UTC, handling DST via zoneinfo
    due_utc = _to_utc(parsed_dt, user_timezone)

    return {"title": title, "due_at": due_utc}


def _to_utc(dt: datetime, iana_tz: str) -> datetime:
    """Convert a tz-aware datetime to UTC, resolving DST via zoneinfo."""
    if dt.tzinfo is None:
        # Attach user tz then convert
        tz = ZoneInfo(iana_tz)
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(timezone.utc)
