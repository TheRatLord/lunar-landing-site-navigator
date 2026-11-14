"""Bounded, replayable event log with SSE streaming (used for job progress).

Event ids are monotonically increasing integers. A reconnecting client sends ``Last-Event-ID`` and
receives every retained event with a larger id, then follows live. The log keeps at most `capacity`
events; progress events older than that are dropped (the first and the terminal event are always
re-derivable from the job record, which the stream replays as a snapshot).
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass

from lunarnav.api.json import dumps


@dataclass(frozen=True, slots=True)
class LogEvent:
    id: int
    event: str
    data: bytes

    def frame(self) -> bytes:
        """SSE wire form: ``id``, ``event``, ``data`` lines and a blank line."""
        return b"id: %d\nevent: %s\ndata: %s\n\n" % (self.id, self.event.encode(), self.data)


class EventLog:
    """Append-only (bounded) log. Must be used from one asyncio loop."""

    def __init__(self, capacity: int = 500) -> None:
        self._items: deque[LogEvent] = deque(maxlen=capacity)
        self._next = 0
        self._closed = False
        self._waiters: list[asyncio.Future[None]] = []

    @property
    def closed(self) -> bool:
        return self._closed

    def append(self, event: str, payload: object) -> LogEvent:
        """Add an event and wake streamers."""
        item = LogEvent(self._next, event, dumps(payload))
        self._next += 1
        self._items.append(item)
        self._wake()
        return item

    def close(self) -> None:
        """No more events will arrive; streamers finish after draining."""
        self._closed = True
        self._wake()

    def _wake(self) -> None:
        for fut in self._waiters:
            if not fut.done():
                fut.set_result(None)
        self._waiters.clear()

    async def stream(self, after_id: int = -1) -> AsyncIterator[LogEvent]:
        """Yield retained events with ``id > after_id``, then live ones, until the log is closed."""
        cursor = after_id
        while True:
            pending = [e for e in self._items if e.id > cursor]
            for item in pending:
                cursor = item.id
                yield item
            if self._closed and cursor >= self._next - 1:
                return
            if pending:
                continue
            fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            self._waiters.append(fut)
            try:
                await fut
            finally:
                if fut in self._waiters:
                    self._waiters.remove(fut)
