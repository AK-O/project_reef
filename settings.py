"""Persistent app settings stored in data/settings.json.

Sensitive fields (ha_token) are encrypted at rest using Fernet symmetric
encryption keyed from SECRET_KEY.  If SECRET_KEY changes, the stored token
becomes unreadable — re-enter it in the admin panel after a key rotation.
"""
import base64
import hashlib
import json
import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_PATH = Path(os.getenv("DATA_DIR", "./data")) / "settings.json"


def _fernet() -> Fernet:
    raw = os.getenv("SECRET_KEY", "").encode()
    # sha256 always yields 32 bytes → valid Fernet key regardless of SECRET_KEY format
    key = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
    return Fernet(key)


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str | None:
    """Return decrypted string, or None if value is not a valid Fernet token."""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        return None


def load() -> dict:
    try:
        return json.loads(_PATH.read_text()) if _PATH.exists() else {}
    except Exception:
        return {}


def save(data: dict) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    out = dict(data)
    if out.get("ha_token"):
        out["ha_token"] = _encrypt(out["ha_token"])
    _PATH.write_text(json.dumps(out, indent=2))


def get_ha_url() -> str:
    return (load().get("ha_url") or os.getenv("HA_URL", "")).rstrip("/")


def get_ha_token() -> str:
    stored = load().get("ha_token") or ""
    if stored:
        decrypted = _decrypt(stored)
        if decrypted is not None:
            return decrypted
        # Looks encrypted but couldn't decrypt — SECRET_KEY likely changed
        if stored.startswith("gAAAAA"):
            logger.warning(
                "HA token is encrypted but cannot be decrypted. "
                "SECRET_KEY may have changed — re-enter the token in the admin panel."
            )
            return ""
        # Pre-encryption plaintext value still in file — return as-is
        return stored
    return os.getenv("HA_TOKEN", "")
