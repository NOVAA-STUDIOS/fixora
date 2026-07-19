# Expected: Ruff B006 (mutable data structure as a default argument).
#
# Included because it is a real bug rather than a style opinion: the list is created once at function
# definition, so every call that omits `into` shares — and accumulates into — the same list. It reads
# as obviously correct and behaves as obviously wrong, which is exactly the kind of defect a developer
# is grateful to have pointed out.
def collect(item, into=[]):
    into.append(item)
    return into
