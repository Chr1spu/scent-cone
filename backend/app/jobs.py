"""Minimal in-process background job tracking (threads)."""
from __future__ import annotations

import threading
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable


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


def submit(fn: Callable[[Job], Any]) -> Job:
    job = Job(uuid.uuid4().hex[:12])
    JOBS[job.id] = job

    def runner():
        job.status = "running"
        try:
            job.result = fn(job)
            job.status, job.progress = "done", 1.0
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            job.status, job.message = "failed", str(e)

    threading.Thread(target=runner, daemon=True).start()
    return job


def get(job_id: str) -> Job | None:
    return JOBS.get(job_id)
