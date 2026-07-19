# Expected: Ruff F821 (undefined name) at the `totl` reference.
#
# A typo'd identifier is the canonical pyflakes catch: it is provably wrong without running the
# program, and it is never intentional. This is the shape of defect Ruff exists to find.
def summarize(values):
    total = sum(values)
    return totl / len(values)
