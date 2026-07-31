import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_PROVIDER_ID, allDescriptors, providerDescriptor } from '@fixora/core-ai';

import { readLegacyModel } from '../credentials/credential-store.js';

/**
 * Which providers the user has turned on, in what order, with which model.
 *
 * The registry holds **preferences, never secrets** — keys live in the credential store, and keeping
 * the two apart means this file can be read, logged and shipped in a bug report without leaking
 * anything. It is also the only place provider ORDER lives, and order is the whole contract with the
 * orchestrator: the chain is built by walking this list, so "the orchestrator always follows user
 * priority" is true by construction rather than by a rule someone has to remember.
 *
 * Priority is stored as an explicit ordered array rather than a number on each entry. Numbers invite
 * duplicates, gaps, and ties that have to be broken by something — an array cannot express any of
 * those, so Move Up / Move Down is a swap and there is no invalid state to validate against.
 */

const REGISTRY_FILE = 'ai-registry.json';
const SCHEMA_VERSION = 1;

export interface ProviderSettings {
  readonly id: string;
  readonly enabled: boolean;
  /** Empty means "use the descriptor's default" — resolved at read time, never written in. */
  readonly model: string;
  /** Overridden API base, for OpenAI-compatible endpoints. Empty means the descriptor's default. */
  readonly baseUrl: string;
}

interface StoredRegistry {
  version: number;
  /** Ordered: index 0 is priority 1. */
  order: string[];
  settings: Record<string, { enabled: boolean; model: string; baseUrl: string }>;
}

export interface ProviderRegistry {
  /** Every known provider, in user priority order, whether enabled or not. */
  list(): readonly ProviderSettings[];
  /** Enabled providers only, in priority order. This is what the orchestrator walks. */
  enabled(): readonly ProviderSettings[];
  get(id: string): ProviderSettings | null;
  /** True when the user has never picked a model for this provider — it is on the descriptor default. */
  modelIsAuto(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
  setModel(id: string, model: string): void;
  setBaseUrl(id: string, baseUrl: string): void;
  /** Swap with the neighbour above. No-op at the top. */
  moveUp(id: string): void;
  /** Swap with the neighbour below. No-op at the bottom. */
  moveDown(id: string): void;
}

export interface ProviderRegistryOptions {
  dir: string;
  fileName?: string;
}

export function createProviderRegistry(options: ProviderRegistryOptions): ProviderRegistry {
  const file = join(options.dir, options.fileName ?? REGISTRY_FILE);
  const state: StoredRegistry = load();

  function load(): StoredRegistry {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredRegistry>;
      return reconcile({
        version: SCHEMA_VERSION,
        order: Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === 'string') : [],
        settings: parsed.settings ?? {},
      });
    } catch {
      return reconcile(migrateLegacy());
    }
  }

  /**
   * A first run on an install that already had OpenRouter configured.
   *
   * The contract for every existing user: they configured OpenRouter once and have not thought about
   * it since, so the upgrade must land them enabled, first in priority, on the model they chose.
   * Anything less is a regression no matter how good the architecture underneath is.
   */
  function migrateLegacy(): StoredRegistry {
    const model = readLegacyModel(options.dir);
    if (model === null) return { version: SCHEMA_VERSION, order: [], settings: {} };
    console.error('[registry] adopted v1 settings', { provider: DEFAULT_PROVIDER_ID, model });
    return {
      version: SCHEMA_VERSION,
      order: [DEFAULT_PROVIDER_ID],
      settings: { [DEFAULT_PROVIDER_ID]: { enabled: true, model, baseUrl: '' } },
    };
  }

  /**
   * Fold the catalog into whatever was stored.
   *
   * Providers ship and are retired across versions, and the stored file is from a previous one. A
   * newly shipped provider is appended (present, disabled — visible in Settings, inert until the user
   * chooses it); a provider no longer in the catalog is dropped. Doing this on every load means the
   * rest of the file can assume the two are in agreement.
   */
  function reconcile(stored: StoredRegistry): StoredRegistry {
    const known = new Set(allDescriptors().map((d) => d.id));
    const order = stored.order.filter((id) => known.has(id));
    for (const descriptor of allDescriptors()) {
      if (!order.includes(descriptor.id)) order.push(descriptor.id);
    }

    const settings: StoredRegistry['settings'] = {};
    for (const id of order) {
      const entry = stored.settings[id];
      settings[id] = {
        // A provider the user has never seen starts OFF. Enabling something that can send source
        // code off the machine is a decision that belongs to the user, not to a default.
        enabled: entry?.enabled ?? false,
        model: entry?.model ?? '',
        baseUrl: entry?.baseUrl ?? '',
      };
    }
    return { version: SCHEMA_VERSION, order, settings };
  }

  function persist(): void {
    writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  }

  function resolve(id: string): ProviderSettings | null {
    const entry = state.settings[id];
    const descriptor = providerDescriptor(id);
    if (entry === undefined || descriptor === null) return null;
    return {
      id,
      enabled: entry.enabled,
      // Resolved on read, so a descriptor's default model can change in a release and every user
      // who never picked one follows it — without a migration that rewrites their file.
      model: entry.model === '' ? descriptor.defaultModel : entry.model,
      baseUrl: entry.baseUrl === '' ? descriptor.baseUrl : entry.baseUrl,
    };
  }

  function swap(id: string, delta: -1 | 1): void {
    const index = state.order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.order.length) return;
    const a = state.order[index];
    const b = state.order[target];
    if (a === undefined || b === undefined) return;
    state.order[index] = b;
    state.order[target] = a;
    persist();
  }

  function update(id: string, patch: Partial<StoredRegistry['settings'][string]>): void {
    const entry = state.settings[id];
    if (entry === undefined) return;
    state.settings[id] = { ...entry, ...patch };
    persist();
  }

  return {
    list: () =>
      state.order.map(resolve).filter((entry): entry is ProviderSettings => entry !== null),
    enabled() {
      return this.list().filter((entry) => entry.enabled);
    },
    get: resolve,
    modelIsAuto: (id) => (state.settings[id]?.model ?? '') === '',
    setEnabled: (id, enabled) => {
      update(id, { enabled });
    },
    setModel: (id, model) => {
      update(id, { model });
    },
    setBaseUrl: (id, baseUrl) => {
      update(id, { baseUrl });
    },
    moveUp: (id) => {
      swap(id, -1);
    },
    moveDown: (id) => {
      swap(id, 1);
    },
  };
}
