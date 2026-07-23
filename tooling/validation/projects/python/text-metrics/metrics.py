"""Small text-statistics helpers used by the reporting layer."""

import os
import re
from collections import Counter

_WORD = re.compile(r"[A-Za-z']+")


def word_count(text):
    """Return the number of word tokens in ``text``."""
    return len(_WORD.findall(text))


def most_common(text, n=5):
    """Return the ``n`` most frequent lowercased words and their counts."""
    words = (m.lower() for m in _WORD.findall(text))
    return Counter(words).most_common(n)


def average_word_length(text):
    """Return the mean length of the word tokens, or 0.0 when there are none."""
    words = _WORD.findall(text)
    if not words:
        return 0.0
    return sum(len(w) for w in words) / len(words)
