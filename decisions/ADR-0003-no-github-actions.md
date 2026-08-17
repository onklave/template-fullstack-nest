# ADR-0003 — No GitHub Actions workflows

**Status:** Accepted

## Context

The reflex when a repository has tests is to add `.github/workflows/ci.yml`.
Onklave builds, tests and deploys **in-cluster**, from `onklave.yaml`.

## Decision

This repository has no `.github/workflows/` directory and must not grow one.
`onklave.yaml` is the entire build and deploy contract; `validation:` in it
names the ordered checks the platform runs.

`.github/dependabot.yml` is present and is the exception: it is a GitHub feature
with no workflow file and no deploy authority.

## Consequences

- A workflow added here would be **inert** for deployment while looking
  authoritative — green CI that deploys nothing, which is worse than no CI.
- A workflow file cannot declare a service, so it cannot express what
  `onklave.yaml` expresses.
- The platform's repository credential cannot push workflow files, so an agent
  that adds one will have its push rejected and lose the work.
- Local validation is the same set of commands the platform runs, so "green on
  my machine" and "green in the build" mean the same thing.
