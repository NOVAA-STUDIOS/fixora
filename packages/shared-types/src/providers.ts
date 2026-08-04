import { z } from 'zod';

import { ProviderHealthSchema } from './provider-health.js';

/**
 * The provider-management contract.
 *
 * The registry, the failover chain and the health store were all built, tested, and completely
 * unreachable: no IPC channel named them, so a user could not enable a provider, reorder priority,
 * or see whether any of it was working. This is the surface that makes existing behaviour usable —
 * it adds no orchestration logic of its own.
 *
 * One row is a JOIN of three sources the renderer must never have to assemble itself:
 *
 *  - the **descriptor** (compiled in): label, whether it needs a key, whether it runs locally, where
 *    to get a key;
 *  - the **registry** (per install): enabled, priority order, chosen model, overridden base URL;
 *  - the **health store** (this session): status, latency, last success/failure, quota.
 *
 * Health is optional on purpose. It is populated from real traffic, so a provider the user has never
 * exercised legitimately has none — and "no data yet" must be distinguishable from "unhealthy".
 */
export const ProviderInfoSchema = z.object({
  id: z.string(),
  /** Human name from the descriptor, e.g. "Ollama (local)". */
  label: z.string(),
  enabled: z.boolean(),
  /** 1-based position in the failover chain. 1 is tried first. */
  priority: z.number().int().positive(),
  /** The model in force — the user's choice, or the descriptor default when they have made none. */
  model: z.string(),
  /** True when `model` is the descriptor default rather than an explicit pick. */
  modelIsAuto: z.boolean(),
  /** The API base in force. For Azure and local endpoints this is install-specific. */
  baseUrl: z.string(),
  /** Whether this provider needs an API key at all. Local providers do not. */
  requiresKey: z.boolean(),
  /** Whether a credential is actually stored. Never the key, never a hint of it. */
  hasKey: z.boolean(),
  /** True when inference happens on the user's machine — drives the privacy note. */
  local: z.boolean(),
  /** Where to obtain a key, when the provider has such a page. */
  keyUrl: z.string().optional(),
  /**
   * Observed health, when any exists.
   *
   * Null means "never exercised", which is deliberately NOT an error state: showing red for a
   * provider nobody has used yet would be a fabricated verdict.
   */
  health: ProviderHealthSchema.nullable(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

/** The whole list, in priority order — index 0 is what the orchestrator tries first. */
export const ProviderListSchema = z.object({
  providers: z.array(ProviderInfoSchema),
});
export type ProviderList = z.infer<typeof ProviderListSchema>;
