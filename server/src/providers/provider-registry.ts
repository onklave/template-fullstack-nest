import { CapabilityProvider } from './capability-provider';

/**
 * Capability -> adapter. The registry is the only place that knows which
 * concrete integrations exist; everything else in the app names a capability.
 *
 * Which adapters are registered is declared once, in app.module.ts.
 */
export class ProviderRegistry {
  private readonly byId = new Map<string, CapabilityProvider>();

  constructor(providers: readonly CapabilityProvider[] = []) {
    providers.forEach((p) => this.register(p));
  }

  register(provider: CapabilityProvider): void {
    if (this.byId.has(provider.id)) {
      // Two adapters answering to one id would make receipts ambiguous about
      // what actually ran.
      throw new Error(`duplicate provider id '${provider.id}'`);
    }
    this.byId.set(provider.id, provider);
  }

  get(id: string): CapabilityProvider | undefined {
    return this.byId.get(id);
  }

  /** Every adapter offering a capability, in registration order. */
  forCapability(capability: string): CapabilityProvider[] {
    return [...this.byId.values()].filter((p) => p.capabilities.includes(capability));
  }

  /**
   * The adapter that will run a capability. First registered wins.
   *
   * THIS is the seam for choosing between two adapters — per organisation, per
   * environment, per feature flag. Adding a second email provider means
   * registering it in app.module.ts and passing a `preferredId` resolved from
   * whatever selects it (the org's settings row, an injected env var). Do not
   * branch on a provider id anywhere else: policy governs the capability, and
   * the receipt records which adapter served it.
   */
  select(capability: string, preferredId?: string): CapabilityProvider | undefined {
    const candidates = this.forCapability(capability);
    if (preferredId) {
      return candidates.find((p) => p.id === preferredId);
    }
    return candidates[0];
  }

  /** Every capability any registered adapter offers (used by the tests). */
  capabilities(): string[] {
    return [...new Set([...this.byId.values()].flatMap((p) => [...p.capabilities]))].sort();
  }
}
