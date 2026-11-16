"""Single source of truth for the finite GPS worker schedule in IST."""

from __future__ import annotations

from datetime import datetime, time as wall_time, timedelta, timezone


IST = timezone(timedelta(hours=5, minutes=30), name="IST")
PEAK_WINDOWS = (
    (wall_time(7, 0), wall_time(9, 15)),
    (wall_time(16, 15), wall_time(19, 15)),
)
STANDBY_START = wall_time(9, 0)
# A short grace period lets the 20:00 Scheduler trigger survive normal Cloud
# Run startup delay without allowing the 20:30 slot to perform a refresh.
STANDBY_LAST_START = wall_time(20, 15)
MIDNIGHT_MAINTENANCE_END = wall_time(0, 15)


def as_ist(now: datetime | None = None) -> datetime:
    """Return an aware timestamp in Indian Standard Time."""

    selected = now or datetime.now(timezone.utc)
    if selected.tzinfo is None:
        selected = selected.replace(tzinfo=timezone.utc)
    return selected.astimezone(IST)


def active_peak_window(now: datetime | None = None) -> tuple[datetime, datetime] | None:
    """Return the active IST peak window, with an exclusive end boundary."""

    local = as_ist(now)
    for start_time, end_time in PEAK_WINDOWS:
        start = datetime.combine(local.date(), start_time, tzinfo=IST)
        end = datetime.combine(local.date(), end_time, tzinfo=IST)
        if start <= local < end:
            return start, end
    return None


def standby_refresh_allowed(now: datetime | None = None) -> bool:
    """Allow a standby poll from 09:00 through the delayed 20:00 trigger."""

    local = as_ist(now)
    return (
        STANDBY_START <= local.time() < STANDBY_LAST_START
        and active_peak_window(local) is None
    )


def midnight_maintenance_due(now: datetime | None = None) -> bool:
    """Identify the 00:01 IST maintenance trigger without depending on UTC."""

    local_time = as_ist(now).time()
    return wall_time(0, 0) <= local_time < MIDNIGHT_MAINTENANCE_END
