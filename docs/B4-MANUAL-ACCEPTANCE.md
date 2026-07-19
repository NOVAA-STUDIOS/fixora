# B4 — Manual Acceptance Test Plan

Release blocker B4 asks one question: **does Fixora repair real code using a real model?**

Everything automated so far verifies the *provider* (real OpenRouter calls succeed, return correct
JavaScript fixes, and fail cleanly on a bad key or unknown model). What has never run against a real
model is the part that makes Fixora more than an API wrapper: **verify → apply → re-analyze**.

This plan closes that gap by hand. Seven languages, one defect each, the production application.

## Before you start

- Build/install: `apps/desktop/release/Fixora-Setup-0.9.0-beta.1.exe`
- Model configured in Settings → AI. Currently `poolside/laguna-xs-2.1:free`.
- **Note the model actually used for each run.** It is part of the evidence.

Each sample lives in its own folder under `samples/`, so "Open folder" gives a clean workspace with
exactly one problem in it. Open them one at a time — a workspace with seven unrelated defects makes
the findings list ambiguous as evidence.

## What to capture for each language

Steps 1–10, in order. For each, capture what the screen actually shows — not what it should show.

| # | Step | Evidence to capture |
|---|---|---|
| 1 | Open folder | Workspace name in the Files panel |
| 2 | Wait for analysis | **Before**: finding count + the rule id and message |
| 3 | Select the finding | Problem Details panel |
| 4 | Click Repair | That the request starts (streaming state) |
| 5 | Wait for the response | Proposed diff |
| 6 | Read the verdict | **verified / regression / unresolved / skipped** |
| 7 | Apply | That the button was enabled and the click succeeded |
| 8 | Re-analysis | **After**: finding count |
| 9 | Open the file | The patched source on disk |
| 10 | Note the time | Roughly, from Repair click to verdict |

A screenshot of the findings list before and after, plus one of the verdict, is enough for all ten.

**If a step fails, stop on that language and capture the failure.** A failure is a result. It is worth
more than six passes, because it is the only kind of evidence that can still change the release
decision.

---

## 1. JavaScript — `samples/broken-js`

**Structure**

```
samples/broken-js/
└── src/total.js
```

**Broken source** — `src/total.js`

```js
export function total(items) {
  let sum = 0;
  for (let i = 0; i <= items.length; i++) {
    sum += items[i];
  }
  return sum;
}
```

**Expected diagnostic** — an off-by-one loop bound. `i <= items.length` reads one index past the end,
so `items[items.length]` is `undefined` and the sum becomes `NaN`.

**Expected repair** — `i <= items.length` → `i < items.length`. Nothing else should change.

**Expected verification** — `verified`. Syntax stays valid, and the original finding disappears
without introducing a new one.

> Already proven at provider level: the model returned exactly this fix, twice, including inside a
> 120-function file. This case is the control — if it fails here, the failure is in the pipeline, not
> the model.

---

## 2. TypeScript — `samples/broken-ts`

**Structure**

```
samples/broken-ts/
└── src/average.ts
```

**Broken source** — `src/average.ts`

```ts
export function average(nums: number[]): number {
  let total = 0;
  for (let i = 0; i <= nums.length; i++) {
    total += nums[i];
  }
  return total / nums.length;
}
```

**Expected diagnostic** — the same off-by-one, but in typed code. Worth testing separately because
the repair must preserve the type annotations, and because TypeScript findings arrive through a
different analyzer path than plain JS.

**Expected repair** — `i <= nums.length` → `i < nums.length`, with `: number[]` and `: number` intact.

**Expected verification** — `verified`.

**Watch for**: a repair that silently drops or widens a type annotation. That would be a
`verified` verdict on a patch that quietly degrades the code, and it is the most valuable thing this
particular case can catch.

---

## 3. React — `samples/broken-react`

**Structure**

```
samples/broken-react/
└── src/Counter.tsx
```

**Broken source** — `src/Counter.tsx`

```tsx
import { useEffect, useState } from 'react';

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);

  useEffect(() => {
    setCount(start);
  });

  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

**Expected diagnostic** — `useEffect` with no dependency array runs after every render, so every
increment is immediately reset. The button appears to do nothing.

**Expected repair** — add `[start]` as the dependency array.

**Expected verification** — `verified`.

**This is the hardest case in the set.** The defect is semantic rather than syntactic: the code parses
fine and every line is individually reasonable. It is also the case where a wrong-but-plausible fix is
most likely — e.g. `[]`, which changes behaviour when `start` changes. **If the verdict is `verified`
but the dependency array is `[]`, record that as a failure**, because it means verification accepted a
patch that only looks correct.

---

## 4. HTML — `samples/broken-html`

**Structure**

```
samples/broken-html/
└── index.html
```

**Broken source** — `index.html`

```html
<!doctype html>
<html>
  <head>
    <title>Demo</title>
  </head>
  <body>
    <img src="logo.png">
    <p>Hello
  </body>
</html>
```

**Expected diagnostic** — two problems: `<img>` has no `alt` attribute (accessibility), and `<p>` is
never closed. Either may be reported; note which, and whether both appear.

**Expected repair** — add `alt="Logo"` (or similar) and close the paragraph.

**Expected verification** — `verified`.

**Watch for**: whether repairing one finding resolves the other silently. If the after-count drops by
two, note it — that is correct behaviour, but the UI should not claim to have fixed only one.

---

## 5. CSS — `samples/broken-css`

**Structure**

```
samples/broken-css/
└── styles.css
```

**Broken source** — `styles.css`

```css
.card {
  color: #333
  background: white;
  padding: 8px;
}
```

**Expected diagnostic** — missing semicolon after `#333`. The parser folds the next line into the
`color` value, so **both** `color` and `background` are lost.

**Expected repair** — add the semicolon. One character.

**Expected verification** — `verified`.

This is the smallest possible patch in the set, which makes it a good test of whether the apply path
handles a single-line splice without disturbing surrounding lines.

---

## 6. JSON — `samples/broken-json`

**Structure**

```
samples/broken-json/
└── config.json
```

**Broken source** — `config.json`

```json
{
  "name": "demo",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
  }
}
```

**Expected diagnostic** — trailing comma after `"tsc"`. Invalid JSON; the file will not parse.

**Expected repair** — remove the comma.

**Expected verification** — `verified`.

**This is the most interesting case for the pipeline, not the model.** The file is *syntactically
invalid to begin with*. If the analyzer cannot parse it, it may produce no finding at all — in which
case there is nothing to repair and the correct result is `skipped`, not a failure. **Record which
happens.** Either outcome is informative; an honest `skipped` is a pass for this case, a crash is not.

---

## 7. Python — `samples/broken-python`

**Structure**

```
samples/broken-python/
└── stats.py
```

**Broken source** — `stats.py`

```python
def mean(values):
    total = 0
    for i in range(len(values) + 1):
        total += values[i]
    return total / len(values)
```

**Expected diagnostic** — `range(len(values) + 1)` runs one index past the end and raises
`IndexError`. The same off-by-one, expressed the way Python expresses it.

**Expected repair** — `range(len(values) + 1)` → `range(len(values))`.

**Expected verification** — `verified`.

**Watch for**: indentation. Python is the one language here where a splice that gets whitespace wrong
produces a file that is broken in a *new* way. If the verdict is `verified`, check the applied file's
indentation by eye before trusting it.

---

## Recording results

For each language, record:

| Field | |
|---|---|
| Language | |
| Model used | |
| Before — finding count, rule, message | |
| Verdict | verified / regression / unresolved / skipped |
| Applied | yes / no |
| After — finding count | |
| Time to verdict | |
| Patch correct on inspection? | yes / no — **judged by reading it, not by the verdict** |

That last row is the one that matters most. A `verified` verdict means the analyzers stopped
complaining; it does not mean the code is right. The React and TypeScript cases exist specifically to
find the gap between those two things.

## Closing B4

B4 can be marked **CLOSED** when all seven languages reach a resolved outcome — `verified` + applied +
the finding gone on re-analysis, or a defensible `skipped` for a case the analyzer genuinely cannot
parse — **and** every applied patch is correct on inspection.

Anything less is a partial result and should be reported as one.
