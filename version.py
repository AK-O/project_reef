"""Single source of truth for the running version."""
import subprocess
from pathlib import Path

def _detect() -> str:
    try:
        return subprocess.check_output(
            ["git", "describe", "--tags", "--always"],
            cwd=Path(__file__).parent,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        pass
    try:
        return (Path(__file__).parent / "VERSION").read_text().strip()
    except Exception:
        return "unknown"

APP_VERSION: str = _detect()
