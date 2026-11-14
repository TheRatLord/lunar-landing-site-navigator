"""In-process event bus: numbers events, persists them, and fans them out to live subscribers."""

from __future__ import annotations

import asyncio
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

from .events import LIVE_ONLY_TYPES
from .store import EventLog

E = TypeVar("E", bound=BaseModel)
SUBSCRIBER_QUEUE_LIMIT = 5000
"""Events a live subscriber may lag behind before it is disconnected (it can replay the transcript)."""


class Emitter(Protocol):
    """Callable that builds, numbers, persists and publishes an event."""

    def __call__(self, event_cls: type[E], **fields: Any) -> E: ...


class EventBus:
    """Single writer of ``transcript.jsonl`` for one run.

    Tools running inside the MCP server and the SDK message translator both publish through the same
    bus, so the transcript order equals the order in which things happened.
    """

    def __init__(self, run_id: str, log: EventLog) -> None:
        self.run_id = run_id
        self.turn = 0
        self._log = log
        self._subscribers: list[asyncio.Queue[BaseModel | None]] = []

    def emit(self, event_cls: type[E], **fields: Any) -> E:
        """Create an event of ``event_cls`` stamped with run id, sequence and current turn."""
        event = event_cls(run_id=self.run_id, seq=self._log.next_seq(), turn=self.turn, **fields)
        if getattr(event, "type", None) not in LIVE_ONLY_TYPES:
            self._log.write(event)
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._drop(queue)
        return event

    def _drop(self, queue: asyncio.Queue[BaseModel | None]) -> None:
        """Disconnect a subscriber that fell `SUBSCRIBER_QUEUE_LIMIT` events behind: its queue is emptied and
        ended, so it re-reads the transcript (which has every event) instead of the run buffering without bound."""
        self.unsubscribe(queue)
        while not queue.empty():
            queue.get_nowait()
        queue.put_nowait(None)

    def subscribe(self) -> asyncio.Queue[BaseModel | None]:
        """Register a queue that receives every later event; ``None`` is the end-of-stream marker."""
        queue: asyncio.Queue[BaseModel | None] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_LIMIT)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[BaseModel | None]) -> None:
        """Remove a queue registered with `subscribe`."""
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def close_subscribers(self) -> None:
        """Send the end-of-stream marker to every subscriber."""
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                self._drop(queue)
