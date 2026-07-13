# Fixora — Engineering Standards

Standards exist to make code reviews about *design* instead of about *style*. Everything mechanical is
automated; everything automated is non-negotiable; everything left is worth arguing about.

---

## 1. Automated, therefore not discussed

| Concern | Tool | Setting |
|---|---|---|
| Formatting | Prettier (TS) / Ruff format (Py) | Zero config debate. It formats on commit. |
| Linting | ESLint (typescript-eslint strict) / Ruff | `--max-warnings 0` |
| Types | `tsc --strict` + `noUncheckedIndexedAccess` / mypy `--strict` | **No `any`. No `# type: ignore`.** Both require a reviewed comment explaining why. |
| Boundaries | dependency-cruiser | The `core-*` import rule (Repo §2) |
| Imports | eslint-plugin-import | Ordered, no cycles |

`noUncheckedIndexedAccess` is the one people push back on. Keep it. `arr[i]` returning `T | undefined` is
*true*, and the bugs it catches are exactly the null-dereference class of bug our product exists to find. We
would look ridiculous shipping them.

---

## 2. The rules from the brief, made concrete

The brief says "no placeholder code, no TODOs, no fake implementations." Agreed — and here is what those
mean in practice, because stated as slogans they get misapplied.

**No TODO comments.** A TODO is an issue that someone hid in the source so they wouldn't have to admit it
existed. Either fix it, or open an issue and link it. `// TODO: handle the error case` is not a plan; it is
a bug with a comment on it.

**No placeholder implementations.** A function that returns `[]` because the real thing is hard is worse
than one that throws — it fails silently, ships, and someone builds on it. **If it isn't implemented, it
throws `NotImplementedError` and the milestone isn't done.**

**But: "no fake implementations" does not mean "no interfaces before implementations."** Test doubles,
in-memory repository fakes, and a `MockProvider` for testing are *legitimate engineering* and we will use
them. The rule is about **shipping** stubs, not about **testing** with them.

**No unnecessary dependencies.** Every `npm install` is a trust decision about a stranger who can ship code
to every one of our customers (Security §7). New dependencies get justified in the PR description: what it
does, why not the stdlib, how big, how maintained, what it costs to remove.

---

## 3. Code conventions

### TypeScript

- **`type` for data, `interface` for contracts** that something implements.
- **Errors are values** at boundaries (`Result`-shaped unions, TDD §9). Exceptions are for bugs.
- **No barrel files inside a feature** — they wreck tree-shaking and create import cycles. One public
  `index.ts` *per feature slice*, exporting the slice's API. That's it.
- **Functions do one thing.** If you need "and" to describe it, it's two functions.
- **Naming:** `is/has/can` for booleans, verbs for functions, nouns for types. `handleX` for event handlers,
  `onX` for props. Boring and predictable beats clever.
- **No default exports** (they make renames silent and grep useless).

### Python

- Pydantic v2 for every boundary. Full type annotations. `async` all the way down — one sync DB call in an
  async handler blocks the event loop and it will be invisible until it isn't.
- Domain layer imports **nothing** from FastAPI.

### React

- Components are **presentational by default.** Logic goes in hooks. A component with a `useEffect` doing
  data fetching is a hook that hasn't been extracted yet.
- **No `useEffect` for derived state.** Derive it during render. This single rule prevents a large fraction
  of React bugs and is violated constantly.
- Every interactive element: keyboard-operable, focus-visible, correctly labelled. Radix for anything with a
  focus trap. **This is not optional and it is not "polish" — our users are keyboard users.**
- `memo`/`useMemo` only with a measurement. Premature memoisation is just noise that makes real perf work
  harder.

---

## 4. Comments

The brief and I agree here, and it's worth being precise about *why*.

**Write a comment to state a constraint the code cannot show.** Not what the next line does (the reader can
read), not where the code came from (that's git), not why your change is correct (that's the PR).

```ts
// Same-directory temp file: rename() is only atomic within a filesystem.   ← constraint. keep.
const tmp = path.join(path.dirname(target), `.fixora-${randomUUID()}`);

// Write to a temp file then rename it                                       ← narration. delete.
```

Public APIs in `packages/core-*` get TSDoc, because they are consumed by code that cannot see their
implementation. Internal functions mostly don't need it.

---

## 5. Definition of Done

A change is done when **all** of these are true. Not most.

- [ ] Types pass strict. Lint passes with zero warnings.
- [ ] Unit tests for the logic; **a test that fails without the change.**
- [ ] Errors are typed, and every user-visible error **names the next step.**
- [ ] No new dependency without justification in the PR.
- [ ] Accessible: keyboard-operable, focus-visible, labelled, `prefers-reduced-motion` respected.
- [ ] No state mirrored across two of the four owners (ADR-015).
- [ ] If it touches the disk: goes through `patch.service`, writes a checkpoint, and undo is tested.
- [ ] If it touches a path: `assertInsideWorkspace` is called.
- [ ] If it sends anything outward: it passes the secret gate.
- [ ] If it touches a prompt, a context strategy, or a model: **the golden corpus score did not regress.**
- [ ] Docs updated if an architectural boundary moved. **An ADR written if a decision was made.**

---

## 6. Code review

Reviewers check, in this order — **and stop at the first "no":**

1. **Does it violate an architectural invariant?** (`core-*` purity · four state owners · secret gate ·
   checkpoint-before-write · path guard.) → block, no discussion.
2. **Is the abstraction earned?** A new layer needs two real callers, not one hypothetical one.
3. **Does it duplicate something?** The third occurrence gets extracted. The second usually shouldn't.
4. **Are the errors typed and actionable?**
5. **Is it tested where it can break?**
6. Style. *(It won't be, because the formatter already handled it.)*

**Reviewers may reject "it works" as insufficient.** "It works" is a statement about today. Everything in
these documents is a statement about month eighteen, which is the only timescale that matters for a product
we intend to still be selling then.
</content>
</invoke>
