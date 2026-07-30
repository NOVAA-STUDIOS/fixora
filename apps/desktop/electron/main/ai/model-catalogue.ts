import {
  NO_FREE_MODELS_MESSAGE,
  fetchModelCatalogue,
  pickDefaultModel,
  type CatalogueModel,
  type FetchLike,
} from '@fixora/core-ai';
import type { AiModelList, ModelCatalogueSource } from '@fixora/shared-types';

/**
 * Owns "which models exist right now".
 *
 * The catalogue is fetched from OpenRouter and cached in memory for the session, because it is the
 * authority: a model id compiled into a release is correct only until a provider rotates its
 * line-up, and the beta already shipped a list that had entirely expired. Resolution and migration
 * both run against whatever this returns.
 *
 * Two failure modes matter and neither may crash the app:
 *
 * - **The network is unreachable.** Analysis, the editor and history are all local and must keep
 *   working. We serve the last good catalogue if we have one, and otherwise report `unavailable` —
 *   we do *not* migrate anyone's model on the strength of a failed fetch, because "I could not
 *   check" is not "your model is gone".
 * - **The catalogue has nothing free.** The user is told, in the words the product promises, and
 *   their existing (possibly paid) model is left alone.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

export interface ModelCatalogueService {
  /** The catalogue for the picker. `refresh` forces a re-fetch, ignoring the TTL. */
  list(refresh?: boolean): Promise<AiModelList>;
  /**
   * The raw catalogue, for callers that need capability metadata rather than picker rows.
   *
   * Failover uses this to drop a fallback that cannot do structured output before spending a request
   * to rediscover it. Serves the cache, so a repair does not pay for a fetch; empty when the
   * catalogue has never loaded, which correctly degrades failover to "no fallbacks" rather than to a
   * guess about what a model can do.
   */
  models(): Promise<readonly CatalogueModel[]>;
  /**
   * Resolve a stored model id against the live catalogue.
   *
   * Returns the id to use plus, when the stored one was retired, the id it replaced — so the caller
   * can tell the user rather than swapping the model out from under them. Returns the stored id
   * unchanged whenever we could not check.
   */
  resolve(stored: string): Promise<{ model: string; migratedFrom: string | null }>;
}

export function createModelCatalogue(fetchImpl?: FetchLike): ModelCatalogueService {
  let cache: CatalogueModel[] | null = null;
  let fetchedAt = 0;
  let inFlight: Promise<CatalogueModel[]> | null = null;

  async function load(refresh: boolean): Promise<CatalogueModel[] | null> {
    const fresh = cache !== null && Date.now() - fetchedAt < CACHE_TTL_MS;
    if (fresh && !refresh) return cache;
    // Collapse concurrent callers (config load + picker open) onto one request.
    inFlight ??= fetchModelCatalogue(fetchImpl)
      .then((models) => {
        cache = models;
        fetchedAt = Date.now();
        return models;
      })
      .finally(() => {
        inFlight = null;
      });

    try {
      return await inFlight;
    } catch (error) {
      console.warn('[ai] model catalogue unavailable', {
        message: error instanceof Error ? error.message : String(error),
        servingCache: cache !== null,
      });
      return cache; // stale beats nothing; null means we have never succeeded
    }
  }

  return {
    async models(): Promise<readonly CatalogueModel[]> {
      return (await load(false)) ?? [];
    },

    async list(refresh = false): Promise<AiModelList> {
      const models = await load(refresh);
      if (models === null) {
        return {
          models: [],
          source: 'unavailable',
          notice:
            'Could not reach OpenRouter to list models. Check your connection — analysis and editing work offline.',
        };
      }

      const source: ModelCatalogueSource = Date.now() - fetchedAt < CACHE_TTL_MS ? 'live' : 'cache';
      const hasFree = models.some((m) => m.free);
      return {
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          free: m.free,
          codeCapable: m.codeCapable,
          structuredOutput: m.structuredOutput,
          contextLength: m.contextLength,
        })),
        source,
        notice: hasFree ? null : NO_FREE_MODELS_MESSAGE,
      };
    },

    async resolve(stored: string): Promise<{ model: string; migratedFrom: string | null }> {
      const models = await load(false);
      // Could not check: never migrate on a failed fetch.
      if (models === null) return { model: stored, migratedFrom: null };

      const current = models.find((m) => m.id === stored);
      if (stored !== '' && current !== undefined) {
        // Available AND capable: nothing to do.
        if (current.structuredOutput) return { model: stored, migratedFrom: null };

        // Available but incapable. Repair and Test cannot work on this model — not "work badly",
        // cannot work — so a user left here has a permanently broken core feature and no way to
        // learn why. Migrating is the same decision already made for retired ids: the id is valid,
        // it just cannot do the job. Only ever migrate to something MEASURED capable.
        const replacement = pickDefaultModel(models);
        const capable = replacement === null ? undefined : models.find((m) => m.id === replacement);
        if (capable?.structuredOutput === true) {
          return { model: capable.id, migratedFrom: stored };
        }
        // Nothing capable to move to. Stay put rather than swap one broken model for another.
        return { model: stored, migratedFrom: null };
      }

      const replacement = pickDefaultModel(models);
      if (replacement === null) {
        // Nothing free to move to. Leave the stored id alone; `list()` carries the explanation.
        return { model: stored, migratedFrom: null };
      }
      return {
        model: replacement,
        // A first run has nothing to migrate *from*, so there is nothing to explain.
        migratedFrom: stored === '' ? null : stored,
      };
    },
  };
}
