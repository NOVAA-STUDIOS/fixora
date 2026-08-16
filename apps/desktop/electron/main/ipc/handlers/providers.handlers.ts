import { allDescriptors, providerDescriptor, providerRegistration } from '@fixora/core-ai';
import type { ProviderInfo, ProviderList } from '@fixora/shared-types';

import type { CredentialStore } from '../../ai/credentials/credential-store.js';
import type { ProviderHealthStore } from '../../ai/provider-health-store.js';
import type { ProviderRegistry } from '../../ai/providers/provider-registry.js';
import { registerHandler } from '../router.js';

/**
 * Model lists, cached for the session.
 *
 * Listing costs a network round trip per provider, and Settings mounts on every visit — without this
 * the panel would re-fetch eight providers each time it opened. Memory only and never persisted: a
 * vendor adding a model between launches should show up on the next launch, not be remembered wrong
 * until a cache file is cleared.
 */
interface ModelList {
  models: string[];
  source: 'live' | 'curated' | 'none';
  notice: string | null;
}

const modelCache = new Map<string, ModelList>();

/**
 * Provider management IPC.
 *
 * The registry, the failover chain and the health store were all built and tested, and none of them
 * was reachable: no channel named them, so a user could not enable a provider, reorder the failover
 * priority, or see whether any of it worked. This file adds no orchestration — it exposes what the
 * orchestrator already reads.
 *
 * ## Two properties worth stating
 *
 * **No credential ever crosses.** These handlers report `hasKey` — a boolean — and nothing else about
 * the key. Key material still moves only through `ai:setKey`/`ai:clearKey`, which is where the
 * encryption and the audit already live.
 *
 * **Every mutation answers with the full refreshed list.** Reordering is relative (swap with a
 * neighbour), so a renderer applying the change locally would re-derive an order main has already
 * computed, and the two would drift the first time a provider appeared or a write failed. Returning
 * the list makes main the single authority on order.
 */
export function registerProviderHandlers(deps: {
  registry: ProviderRegistry;
  credentials: CredentialStore;
  health: ProviderHealthStore;
  /**
   * Called after a credential changes, so an in-flight run built from the OLD key can be aborted.
   * Optional: a host with no running service simply has nothing to cancel.
   */
  onCredentialChange?: () => void;
}): void {
  /**
   * Join the three sources a provider row needs: the compiled-in descriptor, the per-install
   * registry, and this session's observed health. Done here rather than in the renderer so the
   * renderer never has to know that these are three different things.
   */
  function list(): ProviderList {
    const settings = deps.registry.list();
    const providers: ProviderInfo[] = [];

    for (const [index, setting] of settings.entries()) {
      const descriptor = providerDescriptor(setting.id);
      // A registry entry with no descriptor means the app was downgraded past a provider it once
      // knew. Skipped rather than rendered as a broken row — the registry keeps the entry so an
      // upgrade restores it, which is the behaviour `provider-registry.ts` already documents.
      if (descriptor === null) continue;

      providers.push({
        id: setting.id,
        label: descriptor.label,
        enabled: setting.enabled,
        // 1-based: "priority 1" is what a user would say, and index 0 is not.
        priority: index + 1,
        model: setting.model === '' ? descriptor.defaultModel : setting.model,
        modelIsAuto: deps.registry.modelIsAuto(setting.id),
        baseUrl: setting.baseUrl === '' ? descriptor.baseUrl : setting.baseUrl,
        requiresKey: descriptor.auth === 'api-key',
        // Local providers need no credential, so they are never "missing" one.
        hasKey: descriptor.auth === 'none' ? true : deps.credentials.hasKey(setting.id),
        // Masked tail only. The store computes it; key material never crosses.
        keyHint: descriptor.auth === 'none' ? null : deps.credentials.hint(setting.id),
        local: descriptor.local,
        ...(descriptor.keyUrl === undefined ? {} : { keyUrl: descriptor.keyUrl }),
        // Null means "never exercised", which is deliberately not an error state.
        health: deps.health.get(setting.id),
      });
    }

    return { providers };
  }

  registerHandler('providers:list', () => {
    // Touching the registry is enough to materialise any provider that shipped since the stored file
    // was written — `createProviderRegistry` reconciles against the catalogue on load.
    void allDescriptors();
    return list();
  });

  registerHandler('providers:setEnabled', ({ id, enabled }) => {
    deps.registry.setEnabled(id, enabled);
    return list();
  });

  registerHandler('providers:moveUp', ({ id }) => {
    deps.registry.moveUp(id);
    return list();
  });

  registerHandler('providers:moveDown', ({ id }) => {
    deps.registry.moveDown(id);
    return list();
  });

  /**
   * What models this provider offers.
   *
   * Live wherever the vendor serves a list — which is every adapter here, since `test()` already
   * fetches `/models` and reports the ids. The curated list in the descriptor is a FALLBACK, used
   * when the live call cannot run (no key yet) or fails, so choosing a model before saving a key
   * still offers something rather than an empty dropdown.
   *
   * Never throws and never blocks: a provider that cannot be listed returns an empty list plus a
   * notice, and the field stays free text so the user can type an id we have never heard of.
   */
  const listOneProvider = async (id: string, refresh?: boolean): Promise<ModelList> => {
    const cached = modelCache.get(id);
    if (cached !== undefined && refresh !== true) return cached;

    const registration = providerRegistration(id);
    if (registration === null) {
      return { models: [], source: 'none', notice: 'Unknown provider.' } satisfies ModelList;
    }
    const { descriptor } = registration;
    const curated = [...(descriptor.models ?? [])];

    const settings = deps.registry.get(id);
    const apiKey = descriptor.auth === 'none' ? null : deps.credentials.getKey(id);
    if (descriptor.auth === 'api-key' && apiKey === null) {
      const result: ModelList = {
        models: curated,
        source: curated.length > 0 ? 'curated' : 'none',
        notice: 'Add a key to load this provider’s live model list.',
      };
      // Deliberately NOT cached: the next call after a key is saved must try the live list.
      return result;
    }

    let result: ModelList;
    try {
      const adapter = registration.create({
        apiKey,
        baseUrl: settings?.baseUrl ?? descriptor.baseUrl,
      });
      const probe = await adapter.test(settings?.model ?? descriptor.defaultModel, AbortSignal.timeout(10_000));
      const live = [...(probe.models ?? [])];
      result =
        live.length > 0
          ? { models: live, source: 'live', notice: null }
          : {
              models: curated,
              source: curated.length > 0 ? 'curated' : 'none',
              notice: 'This provider did not return a model list.',
            };
    } catch {
      // A listing failure is never a repair failure. Fall back and say so.
      result = {
        models: curated,
        source: curated.length > 0 ? 'curated' : 'none',
        notice: 'Could not reach this provider to list its models.',
      };
    }
    modelCache.set(id, result);
    return result;
  };

  registerHandler('providers:listModels', ({ id, refresh }) => listOneProvider(id, refresh));

  // Batched: one round trip for every id a caller names, instead of one `providers:listModels`
  // call per provider row fired simultaneously on mount — each provider's own probe still runs
  // independently (and still costs what it cost before), but main answers ONE request, not N.
  registerHandler('providers:listAllModels', async ({ ids }) => {
    const entries = await Promise.all(
      ids.map(async (id) => [id, await listOneProvider(id)] as const),
    );
    return Object.fromEntries(entries);
  });

  registerHandler('providers:setModel', ({ id, model }) => {
    deps.registry.setModel(id, model);
    return list();
  });

  registerHandler('providers:setBaseUrl', ({ id, baseUrl }) => {
    deps.registry.setBaseUrl(id, baseUrl);
    return list();
  });

  /**
   * Save a key for ONE named provider.
   *
   * The whole bug this replaces: `ai:setKey` writes `DEFAULT_PROVIDER_ID` — always OpenRouter — so a
   * user pasting a Gemini key overwrote their OpenRouter credential and Gemini stayed unusable. The
   * credential store was always keyed per provider; only the handler was not.
   *
   * Enabling on save is deliberate. A user who has just pasted a key for a provider has stated their
   * intent as plainly as the UI allows, and leaving it disabled would reproduce the same confusion
   * from the other side — a key that is stored, correct, and still never used. Priority is NOT
   * touched: which provider goes first is a separate decision, and taking it for them here would
   * silently reorder a chain they may have arranged deliberately.
   */
  registerHandler('providers:setKey', ({ id, key, makePrimary }) => {
    deps.credentials.setKey(id, key);
    // A different key can see a different catalogue — entitlements are per key, not per provider.
    modelCache.delete(id);
    deps.registry.setEnabled(id, true);
    // The primary field detected this provider from the key itself, so the user's intent is "use
    // this one" — which means the head of the chain, not merely enabled somewhere in it. The
    // per-provider slots below never set this: an explicit save into a named row is not a claim
    // about priority, and silently reordering there would undo an order the user chose by hand.
    if (makePrimary === true) deps.registry.makePrimary(id);
    // Abort anything in flight: a run already issued was built from the PREVIOUS credential, and
    // letting it finish would report that key's verdict against the one just saved.
    deps.onCredentialChange?.();
    return list();
  });

  registerHandler('providers:clearKey', ({ id }) => {
    deps.credentials.clearKey(id);
    modelCache.delete(id);
    // Deliberately NOT disabled. A provider the user enabled stays enabled; it simply has no key and
    // is skipped by the chain until one is supplied. Silently flipping the switch off would hide the
    // fact that they still intend to use it.
    deps.onCredentialChange?.();
    return list();
  });
}
