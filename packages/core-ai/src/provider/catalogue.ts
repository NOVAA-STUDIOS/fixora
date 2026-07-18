import type { FetchLike } from './openrouter.js';

/**
 * The live OpenRouter model catalogue.
 *
 * Hardcoded model ids are what broke the beta: OpenRouter retires slugs as providers rotate their
 * line-ups and answers a retired slug with a bare 404, so a list baked into a release goes stale on
 * someone else's schedule. The catalogue is therefore fetched, and **it is the authority** on what
 * exists. The only ids compiled in are *preferences* — an ordered wish-list resolved against whatever
 * the catalogue actually returns, never used as ids in their own right.
 *
 * `/api/v1/models` is public: no key, and deliberately no `Authorization` header, so the catalogue
 * can be listed before the user has configured anything. That keeps BYOK intact — nothing here
 * touches the key, and nothing here routes a request through Fixora.
 */

export const CATALOGUE_ENDPOINT = 'https://openrouter.ai/api/v1/models';

export interface CatalogueModel {
  readonly id: string;
  readonly name: string;
  /** Free to call: a `:free` variant, or zero prompt *and* completion pricing. */
  readonly free: boolean;
  /** The model presents itself as code/programming oriented (name or description). */
  readonly codeCapable: boolean;
}

/**
 * Free code models we would pick first for the beta, best-fit first. These are **preferences, not
 * ids we trust**: each is checked against the catalogue and skipped if absent, so a retired
 * preference costs nothing. If none survive, `pickDefaultModel` falls back to any free code model,
 * then any free model at all.
 */
export const PREFERRED_FREE_CODE_MODELS: readonly string[] = [
  'cohere/command-a-mini-code:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-xs-2.1:free',
];

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
}

/** "0", "0.0", 0 all mean free; anything unparseable is treated as paid (fail closed on cost). */
function isZeroPrice(value: unknown): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value !== 'string') return false;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed === 0;
}

const CODE_HINT = /\b(code|coding|programm|developer|swe|software engineer)/i;

export function toCatalogueModel(raw: RawModel | null | undefined): CatalogueModel | null {
  // The payload is someone else's JSON: a null or non-object entry must be skipped, not thrown on.
  if (raw === null || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id;
  const description = typeof raw.description === 'string' ? raw.description : '';

  const free =
    raw.id.endsWith(':free') ||
    (raw.pricing !== null &&
      raw.pricing !== undefined &&
      isZeroPrice(raw.pricing.prompt) &&
      isZeroPrice(raw.pricing.completion));

  return {
    id: raw.id,
    name,
    free,
    codeCapable: CODE_HINT.test(name) || CODE_HINT.test(description) || CODE_HINT.test(raw.id),
  };
}

/**
 * Fetch the catalogue. Throws on transport failure or a malformed payload so the caller can decide
 * what to do with a stale cache — silently returning an empty list would read as "no models exist"
 * and would migrate a perfectly good configuration away.
 */
export async function fetchModelCatalogue(fetchImpl?: FetchLike): Promise<CatalogueModel[]> {
  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));
  const response = await doFetch(CATALOGUE_ENDPOINT, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`OpenRouter model catalogue returned ${String(response.status)}`);
  }
  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) {
    throw new Error('OpenRouter model catalogue had no data array');
  }
  const models = payload.data
    .map((entry) => toCatalogueModel(entry as RawModel))
    .filter((m): m is CatalogueModel => m !== null);
  if (models.length === 0) {
    throw new Error('OpenRouter model catalogue was empty');
  }
  return models;
}

export function isModelAvailable(catalogue: readonly CatalogueModel[], id: string): boolean {
  return catalogue.some((m) => m.id === id);
}

/**
 * Choose the default model: the first preference that actually exists, else any free code-capable
 * model, else any free model. Returns null when the catalogue has no free model at all — the caller
 * surfaces that to the user rather than silently selecting something billable.
 */
export function pickDefaultModel(catalogue: readonly CatalogueModel[]): string | null {
  for (const preferred of PREFERRED_FREE_CODE_MODELS) {
    if (isModelAvailable(catalogue, preferred)) return preferred;
  }
  const freeCode = catalogue.find((m) => m.free && m.codeCapable);
  if (freeCode !== undefined) return freeCode.id;
  const anyFree = catalogue.find((m) => m.free);
  return anyFree?.id ?? null;
}

/** Message shown when the catalogue is reachable but offers nothing free. */
export const NO_FREE_MODELS_MESSAGE =
  'No free OpenRouter models are currently available. Please choose a paid model or add OpenRouter credits.';
