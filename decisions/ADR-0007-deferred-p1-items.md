# ADR-0007 — What this starter deliberately does not ship

**Status:** Accepted

## Context

The Governed App Starter spec describes more than a starter should contain.
Every file here lands in every generated app, so the bar is "the smallest thing
that teaches the pattern". These are the things left out on purpose, with what
would trigger adding each.

## Decision

| Not shipped | Why | Add it when |
|---|---|---|
| **Architecture tests** (spec §26) — machine-enforced import rules | Needs a lint plugin or a dependency-cruiser config; the rules are few and stated in `architecture/boundaries.md`, enforced in review | The rules are broken more than once, or the app grows past a handful of directories |
| **E2E governance tests** (spec §24) | Needs a browser runner, a live database and a deployed environment. The same properties are asserted at the unit level in `action-executor.test.ts` — approval not bypassable, no duplicate execution, stale state blocks execution | The app has a real UI flow for a governed action |
| **A `surfaces/` directory** (spec §7) | The app has exactly one surface. A directory tree for one surface is ceremony | A second surface is declared in `onklave.yaml` — see `architecture/boundaries.md` |
| **Resumable workflow state + completion surfaces** (spec §14, §18) | Requires durable action state, which this template deliberately does not have (ADR-0006). A single-step action needs neither | An action spans more than one request, or waits on a human |
| **A UI for the governed action** | The pattern being taught is server-side. A button would add client state, a form and a spec file without teaching anything the tests do not | The app grows a real screen for it — then follow `skills/add-feature/SKILL.md` |
| **Diff classification** (spec §31, P2) | Belongs to the platform, not to a generated repo | Never, here. The classes are documented in `AGENTS.md` §10 for humans and agents to apply |

`validation:` in `onklave.yaml` therefore lists `lint`, `typecheck`, `test`,
`build` and **not** `architecture-test` or `e2e`. Declaring a step that does not
exist would be the same mistake as declaring a capability the code does not
enforce.

## Consequences

- The repository stays small enough to read, and every declaration in it is true.
- Each deferral has a named trigger, so growing into it is a decision rather
  than a discovery.
- When one is added, update `validation:` in the same change.
