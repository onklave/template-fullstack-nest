# ADR-0005 — One registry, not a ProviderRegistry and a CapabilityRegistry

**Status:** Accepted

## Context

The Governed App Starter spec names two registries: a `ProviderRegistry` and a
`CapabilityRegistry`. In a large system those are different things — one owns
adapter lifecycles, the other owns the capability catalogue and its policy.

## Decision

This template ships **one** class, `ProviderRegistry`, which answers both
questions: `get(id)` for an adapter and `select(capability, preferredId?)` /
`forCapability(capability)` for a capability. The capability *catalogue* is the
`ACTION_POLICY` table in `app.module.ts` — a plain object, deny by default —
mirrored by `capabilities:` in `onklave.yaml`.

## Consequences

- Roughly fifty lines instead of two collaborating classes, a lookup indirection
  and a registration order to reason about. A developer reads the whole thing in
  one sitting, which is the point of a starter.
- Nothing is lost that this app needs: policy is still expressed against
  capabilities, and adapters are still replaceable without touching it.
- If an app grows a genuine capability catalogue — descriptions, per-tenant
  enablement, dynamic registration — split it then, and supersede this ADR.
