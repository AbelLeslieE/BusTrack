"""Small process-local maintenance gate used while a database restore runs."""

from __future__ import annotations

import threading


_restore_lock = threading.Lock()


def begin_restore() -> bool:
    """Begin a restore only if another restore is not already in progress."""

    return _restore_lock.acquire(blocking=False)


def end_restore() -> None:
    if _restore_lock.locked():
        _restore_lock.release()


def restore_in_progress() -> bool:
    return _restore_lock.locked()
