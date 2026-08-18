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
| **A `surfaces/` directory** (spec §7) | The app has exactly one surface. A directory tree for one surface is ceremony | A second surface is declared in `onklave.yaml` — see `architecture/boundaries.md` |
| **Resumable workflow state + completion surfaces** (spec §14, §18) | A single-step action needs neither. The durable state they would build on now exists (ADR-0008), so this is a smaller step than it was | An action spans more than one request, or waits on a human |
| **A UI for the governed action** | The pattern being taught is server-side. A button would add client state, a form and a spec file without teaching anything the tests do not | The app grows a real screen for it — then follow `skills/add-feature/SKILL.md` |
| **Durable approvals** | `ApprovalStore` is a `Map`. Nothing in this app grants an approval outside a single request, so persisting it would be storage for a value with no writer — see ADR-0006 | Approvals are granted through a separate human workflow; they then need an expiry too |
| **Diff classification** (spec §31, P2) | Belongs to the platform, not to a generated repo | Never, here. The classes are documented in `AGENTS.md` §10 for humans and agents to apply |

## Two of these have since shipped

Recorded here rather than deleted, because *why a deferral was wrong* is worth
as much as the deferral:

- **Architecture tests** (spec §26) were deferred on the assumption they needed
  a lint plugin or a dependency-cruiser config. They did not: a directory walk
  over the import lines is enough, and `server/test/architecture.test.ts` is now
  the machine-enforced form of `architecture/boundaries.md`. It also caught the
  thing prose could not — `capabilities:` in `onklave.yaml` drifting from
  `ACTION_POLICY`, and a `validation:` step naming a script nobody wrote.
- **E2E governance tests** (spec §24) were deferred on the assumption they
  needed a browser, a live database and a deployed environment. The few that are
  genuinely worth having need none of those: the app boots in-process on an
  ephemeral port with Node's own `fetch`. `server/test/governance.e2e.test.ts`
  asserts only what cannot be seen below HTTP — the `/api` prefix, freshness
  headers, action state → status, a duplicate across two real requests, and no
  credential in any response body. A UI flow is still not tested, and does not
  need to be until there is a UI.

`validation:` in `onklave.yaml` therefore now lists `architecture-test` and
`e2e` alongside `lint`, `typecheck`, `test` and `build` — and
`architecture.test.ts` asserts that every step there is a real npm script, so
the rule that governed the original omission is now enforced rather than
remembered.

## Consequences

- The repository stays small enough to read, and every declaration in it is true.
- Each deferral has a named trigger, so growing into it is a decision rather
  than a discovery.
- When one is added, update `validation:` in the same change.
