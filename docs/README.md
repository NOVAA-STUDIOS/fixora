# Fixora — Engineering Blueprint

> **Fix Smarter. Ship Faster.**
> Fixora is the workspace you open when the code is already broken.

This directory contains a mix of current operational guidance, historical design proposals, and
decision records. **The checked-out implementation is the source of truth for current behavior.** A
blueprint or accepted ADR may describe a target that was deferred or superseded; check the status notes
below and the implementation before relying on such a claim.

---

## Reading order

| # | Document | Read it when |
|---|---|---|
| 00 | [Design Review](./00-DESIGN-REVIEW.md) | You are touching any pixel of the product or the site |
| 01 | [Architecture Overview](./01-ARCHITECTURE.md) | You want the 20-minute version of everything |
| 02 | [Roadmap](./02-ROADMAP.md) | You are planning or scoping work |
| 03 | [**Decision Register (ADRs)**](./03-DECISION-REGISTER.md) | **You disagree with something. Start here.** |
| 10 | [Product Requirements (PRD)](./10-PRD.md) | You are deciding what to build |
| 11 | [Technical Design (TDD)](./11-TDD.md) | You are deciding how to build it |
| 12 | [System Architecture & Diagrams](./12-SYSTEM-ARCHITECTURE.md) | You need the component/sequence/data-flow picture |
| 13 | [Database Design](./13-DATABASE-DESIGN.md) | You are touching persistence |
| 14 | [AI Pipeline Architecture](./14-AI-PIPELINE.md) | You are touching prompts, context, providers, or cost |
| 15 | [Security Architecture](./15-SECURITY-ARCHITECTURE.md) | You are touching anything at all |
| 16 | [Local-First Data Strategy](./16-LOCAL-FIRST-STRATEGY.md) | You are about to send data over a wire |
| 17 | [API Architecture](./17-API-ARCHITECTURE.md) | You are adding or changing an endpoint |
| 18 | [Repository Structure](./18-REPOSITORY-STRUCTURE.md) | You are creating a file |
| 19 | [Engineering Standards](./19-ENGINEERING-STANDARDS.md) | You are writing or reviewing code |
| 20 | [Testing Strategy](./20-TESTING-STRATEGY.md) | You are writing a test, or wondering why CI failed |
| 21 | [Packaging & Auto-Update](./21-PACKAGING-AND-UPDATES.md) | You are shipping a build |
| 22 | [Deployment Strategy](./22-DEPLOYMENT.md) | You are shipping the API or the site |
| 23 | [Scalability Roadmap](./23-SCALABILITY-ROADMAP.md) | You are tempted to build for a future that may not arrive |

---

## Current implementation at a glance

The desktop application is Electron + React/Vite. A sandboxed preload exposes a narrow bridge; the main
process validates IPC with shared Zod contracts and owns local workspace/filesystem/PTY/SQLite services.
SQLite uses Node's built-in `node:sqlite` driver. Desktop provider requests are integrated through
`packages/core-ai`; there is no deployed FastAPI/Neon application backend in this repository. The
separate Next.js web chat uses a server route as a BYOK provider proxy.

Current Zappr file/repair flow: strict shared plan schema, safe workspace-relative paths, an explicit
main-owned approval gate, atomic verified writes, preflight snapshots and reverse-order rollback,
scoped run IDs/cancellation, and run-scoped events. Renderer context includes Ctrl+I selection,
`@mentions`, active-file fallback, deduplication, and derived live status. See the current status section
in [Architecture Overview](./01-ARCHITECTURE.md). These descriptions apply to the checked-out working
tree; they do not imply every change is included in a published release.

Treat these constraints as design intent; verify each one against the current implementation and
applicable newer decisions before extending it.

---

## Status and authority

| Milestone | Status |
|---|---|
| Desktop app | Implemented; see code and current architecture snapshot. |
| Web app | Implemented as a separate Next.js BYOK chat; see `apps/web/README.md`. |
| Release | Tag-driven Windows release; GitHub Actions validates artifacts before publish, signs when configured, and has an explicit unsigned v1.2.26 exception. See `RELEASING.md`. |
| Blueprint and roadmap | Historical/planned design context; not a current implementation checklist. |

**Version/release authority:** a production desktop release tag (`vMAJOR.MINOR.PATCH`) is canonical at
release time. The package-version snapshot and tag injection are documented in
[RELEASING.md](./RELEASING.md). `03-DECISION-REGISTER.md` and generated ADRs preserve decision history;
ADR-033 supersedes ADR-011's database-driver choice. ADR-022's self-hosted updater feed remains future
work; the current updater uses GitHub Releases.
</content>
</invoke>
