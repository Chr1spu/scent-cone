"""Minimal in-process background job tracking (threads).

At most config.MAX_RUNNING_JOBS run at once; the rest wait in a FIFO queue of at most
config.MAX_QUEUED_JOBS, and submit() raises QueueFull beyond that.
"""
from __future__ import annotations

import threading
import traceback
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from . import config


class QueueFull(Exception):
    """Too many jobs waiting; the caller should try again later."""


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | failed
    progress: float = 0.0
    message: str = ""
    result: Any = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(self, progress: float, message: str) -> None:
        with self._lock:
            self.progress, self.message = float(progress), message

    def to_json(self) -> dict:
        return {"jobId": self.id, "status": self.status, "progress": round(self.progress, 3),
                "message": self.message, "result": self.result}


JOBS: dict[str, Job] = {}
_cv = threading.Condition()
_waiting: deque[str] = deque()
_running = 0


def _queue_messages() -> None:
    """Tell each waiting job where it stands (call with _cv held)."""
    for i, jid in enumerate(_waiting):
        ahead = _running + i
        JOBS[jid].message = f"Server busy: waiting for {ahead} earlier wind job{'s' if ahead != 1 else ''}"


def _prune() -> None:
    """Drop the oldest finished jobs beyond config.MAX_FINISHED_JOBS (call with _cv held)."""
    finished = [jid for jid, j in JOBS.items() if j.status in ("done", "failed")]
    for jid in finished[:max(0, len(finished) - config.MAX_FINISHED_JOBS)]:
        del JOBS[jid]


def submit(fn: Callable[[Job], Any]) -> Job:
    with _cv:
        if len(_waiting) >= config.MAX_QUEUED_JOBS:
            raise QueueFull(f"{len(_waiting)} jobs already waiting")
        _prune()
        job = Job(uuid.uuid4().hex[:12])
        JOBS[job.id] = job
        _waiting.append(job.id)
        _queue_messages()

    def runner():
        global _running
        with _cv:
            while _running >= config.MAX_RUNNING_JOBS or _waiting[0] != job.id:
                _cv.wait()
            _waiting.popleft()
            _running += 1
            job.status, job.message = "running", "Starting"
            _queue_messages()
        try:
            job.result = fn(job)
            job.status, job.progress = "done", 1.0
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job.status, job.message = "failed", str(e)
        finally:
            with _cv:
                _running -= 1
                _queue_messages()
                _cv.notify_all()

    threading.Thread(target=runner, daemon=True).start()
    return job


def get(job_id: str) -> Job | None:
    return JOBS.get(job_id)
