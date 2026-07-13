# Fixora — Engineering Blueprint

> **Fix Smarter. Ship Faster.**
> Fixora is the workspace you open when the code is already broken.

This directory is the single source of truth for what Fixora is, how it is built, and why every
significant decision was made the way it was. It is written to be _followed_, not admired. If code and
this blueprint disagree, one of them is a bug.

---

## Reading order

| #   | Document                                                      | Read it when                                              |
| --- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 00  | [Design Review](./00-DESIGN-REVIEW.md)                        | You are touching any pixel of the product or the site     |
| 01  | [Architecture Overview](./01-ARCHITECTURE.md)                 | You want the 20-minute version of everything              |
| 02  | [Roadmap](./02-ROADMAP.md)                                    | You are planning or scoping work                          |
| 03  | [**Decision Register (ADRs)**](./03-DECISION-REGISTER.md)     | **You disagree with something. Start here.**              |
| 10  | [Product Requirements (PRD)](./10-PRD.md)                     | You are deciding what to build                            |
| 11  | [Technical Design (TDD)](./11-TDD.md)                         | You are deciding how to build it                          |
| 12  | [System Architecture & Diagrams](./12-SYSTEM-ARCHITECTURE.md) | You need the component/sequence/data-flow picture         |
| 13  | [Database Design](./13-DATABASE-DESIGN.md)                    | You are touching persistence                              |
| 14  | [AI Pipeline Architecture](./14-AI-PIPELINE.md)               | You are touching prompts, context, providers, or cost     |
| 15  | [Security Architecture](./15-SECURITY-ARCHITECTURE.md)        | You are touching anything at all                          |
| 16  | [Local-First Data Strategy](./16-LOCAL-FIRST-STRATEGY.md)     | You are about to send data over a wire                    |
| 17  | [API Architecture](./17-API-ARCHITECTURE.md)                  | You are adding or changing an endpoint                    |
| 18  | [Repository Structure](./18-REPOSITORY-STRUCTURE.md)          | You are creating a file                                   |
| 19  | [Engineering Standards](./19-ENGINEERING-STANDARDS.md)        | You are writing or reviewing code                         |
| 20  | [Testing Strategy](./20-TESTING-STRATEGY.md)                  | You are writing a test, or wondering why CI failed        |
| 21  | [Packaging & Auto-Update](./21-PACKAGING-AND-UPDATES.md)      | You are shipping a build                                  |
| 22  | [Deployment Strategy](./22-DEPLOYMENT.md)                     | You are shipping the API or the site                      |
| 23  | [Scalability Roadmap](./23-SCALABILITY-ROADMAP.md)            | You are tempted to build for a future that may not arrive |

---

## The four sentences that explain the whole product

1. **The twelve capabilities are one pipeline.** `Ground → Reason → Propose → Verify → Present`, invoked
   with twelve different task profiles. Adding a capability must never require touching the engine.
2. **The LLM reasons over evidence, never over vibes.** Deterministic analysis (tree-sitter, ESLint,
   `tsc`, ruff, Semgrep) produces the findings; the model explains and repairs them.
3. **Every fix ships with its proof.** Patches are applied to an overlay filesystem, re-checked, and
   re-tested before the user ever sees them.
4. **Code stays on the user's machine unless they say otherwise.** History is local SQLite. The cloud
   holds accounts, entitlements and usage — never source code.

If a proposed change violates one of those four, it is wrong, regardless of how convenient it is.

---

## Status

| Milestone       | Status                                                         |
| --------------- | -------------------------------------------------------------- |
| Blueprint       | ✅ **Signed off — 2026-07-13.** All 28 ADRs Accepted.          |
| M0 Foundations  | 🟡 Ready to start — blocked only on the repo move + `git init` |
| Everything else | ⏸ Not started                                                  |

**Signed-off decisions of record (2026-07-13):**
FastAPI backend (ADR-008) · 4 launch capabilities, not 12 (ADR-024) · TypeScript + Python + Go (ADR-025) ·
Violet accent (ADR-026) · Local-first + SQLite + BYOK + verification-first (ADR-002/003/004/011).

**No production code exists yet, by design.**
</content>
</invoke>
