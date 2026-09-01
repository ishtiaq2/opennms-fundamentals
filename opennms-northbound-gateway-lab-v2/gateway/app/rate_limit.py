"""
A small in-memory token-bucket rate limiter, shared by the REST
middleware (rest/... via main.py) and the gRPC interceptor
(grpc_app/interceptors.py).

This is the whole point of putting rate limiting in the *gateway*
module rather than in OpenNMS itself, or in Nginx: one implementation,
one set of limits, enforced identically no matter which protocol the
client used to get in.

Design notes (also covered in GUIDE.md Part 6):
- Token bucket, not fixed window: allows short bursts while still
  capping the average rate, and doesn't have the "thundering herd at
  the window boundary" problem a fixed window does.
- In-memory + a lock: correct for a single gateway process. Run more
  than one replica and each will enforce its own limit independently -
  fine for a lab, not fine for production. Swap `_buckets` for a
  Redis-backed store (INCR + TTL, or a Lua token-bucket script) if you
  need a shared limit across replicas. That's flagged as an extension
  exercise in GUIDE.md Part 9 rather than built here, to keep this
  module's job crisp: rate limiting, not distributed-systems plumbing.
"""
import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


class TokenBucketLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        if max_requests <= 0 or window_seconds <= 0:
            raise ValueError("max_requests and window_seconds must be positive")
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._refill_rate = max_requests / window_seconds  # tokens per second
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def allow(self, client_key: str) -> tuple[bool, float]:
        """
        Consume one token for `client_key`.

        Returns (allowed, retry_after_seconds). retry_after_seconds is
        0.0 when allowed=True, and an estimate of how long the caller
        should wait otherwise.
        """
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(client_key)
            if bucket is None:
                # First request from this client: give it a fresh full
                # bucket minus the token it's about to spend.
                self._buckets[client_key] = _Bucket(
                    tokens=self.max_requests - 1, last_refill=now
                )
                return True, 0.0

            elapsed = now - bucket.last_refill
            bucket.tokens = min(
                self.max_requests, bucket.tokens + elapsed * self._refill_rate
            )
            bucket.last_refill = now

            if bucket.tokens >= 1:
                bucket.tokens -= 1
                return True, 0.0

            missing = 1 - bucket.tokens
            retry_after = missing / self._refill_rate
            return False, retry_after

    def reset(self) -> None:
        """Mainly useful for tests."""
        with self._lock:
            self._buckets.clear()
