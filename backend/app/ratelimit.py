"""Per-client sliding-window rate limits for the expensive POST endpoints."""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, Request


def client_ip(request: Request) -> str:
    """The Cloudflare tunnel puts the visitor's address in CF-Connecting-IP; everything
    else arrives from the tunnel (or localhost) directly."""
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


class RateLimit:
    def __init__(self, limit: int, window_s: float, clock=time.monotonic):
        self.limit, self.window_s, self.clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> float | None:
        """Record a request; return None if allowed, else seconds until the next one is."""
        now = self.clock()
        with self._lock:
            # forget idle clients so the table cannot grow without bound
            for k in [k for k, q in self._hits.items() if q[-1] <= now - self.window_s]:
                del self._hits[k]
            q = self._hits.setdefault(key, deque())
            while q and q[0] <= now - self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return q[0] + self.window_s - now
            q.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def dependency(self, request: Request) -> None:
        """FastAPI dependency: 429 with Retry-After once a client is over the limit."""
        wait = self.hit(client_ip(request))
        if wait is not None:
            mins = max(1, round(wait / 60))
            raise HTTPException(429, f"Too many requests from your address; try again in about {mins} min.",
                                headers={"Retry-After": str(int(wait) + 1)})
