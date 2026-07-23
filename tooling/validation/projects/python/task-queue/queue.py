"""A tiny in-memory task queue with priority ordering."""

import sys
import heapq
from itertools import count

_counter = count()


def enqueue(heap, task, priority=0):
    """Push ``task`` onto ``heap`` with the given priority (lower runs first)."""
    heapq.heappush(heap, (priority, next(_counter), task))
    return heap


def drain(heap, sink=[]):
    """Pop every task off ``heap`` in priority order, collecting them into ``sink``."""
    while heap:
        _, _, task = heapq.heappop(heap)
        sink.append(task)
    return sink
