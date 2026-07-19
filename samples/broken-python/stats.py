def mean(values):
    total = 0
    for i in range(len(values) + 1):
        total += values[i]
    return total / len(values)
