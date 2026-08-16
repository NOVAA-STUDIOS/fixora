from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator


@dataclass
class Point:
    x: float
    y: float

    def distance_to_origin(self) -> float:
        return (self.x**2 + self.y**2) ** 0.5


def evens(limit: int) -> Iterator[int]:
    for n in range(limit):
        if n % 2 == 0:
            yield n


@contextmanager
def timer_label(label: str) -> Iterator[str]:
    yield label
