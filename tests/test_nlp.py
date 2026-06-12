from nlp import parse_task_input


def test_no_date():
    result = parse_task_input("Buy milk")
    assert result["title"] == "Buy milk"
    assert result["due_at"] is None


def test_time_only(freezer=None):
    result = parse_task_input("Eier kaufen 17:00")
    assert "Eier kaufen" in result["title"]
    assert result["due_at"] is not None
    # Should be stored in UTC, hour 17 (CET=UTC+1) → 16:00 UTC or CEST → 15:00
    assert result["due_at"].hour in (14, 15, 16)  # flexible for DST


def test_german_relative():
    result = parse_task_input("Meeting morgen 14:00")
    assert "Meeting" in result["title"]
    assert result["due_at"] is not None


def test_english_relative():
    result = parse_task_input("Call dad in 2 hours")
    assert "Call dad" in result["title"]
    assert result["due_at"] is not None


def test_day_name():
    result = parse_task_input("Müll rausbringen Montag")
    assert "Müll rausbringen" in result["title"]
    assert result["due_at"] is not None


def test_empty_input():
    result = parse_task_input("")
    assert result["title"] == ""
    assert result["due_at"] is None


def test_due_at_is_utc():
    from datetime import timezone
    result = parse_task_input("Reminder tomorrow 9:00")
    if result["due_at"]:
        assert result["due_at"].tzinfo is not None
        assert result["due_at"].tzinfo == timezone.utc or "UTC" in str(result["due_at"].tzinfo)
