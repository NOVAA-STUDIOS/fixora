import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import type { AIProvider } from '../types.js';

import { createOpenAiCompatibleProvider, type FetchLike } from './openai-compatible.js';

export type { FetchLike };

/**
 * OpenRouter — the default provider, and the one every existing user is already on.
 *
 * Now a descriptor plus twelve lines of configuration over the shared OpenAI-compatible transport.
 * The SSE parsing, error-body reading and usage accounting it used to own are the same code as
 * before, just moved: this file adds only what is genuinely OpenRouter-specific, which is the
 * attribution headers and the 404-means-retired-slug hint.
 *
 * `json: 'per-model'` is the important line. OpenRouter fronts 338 models and 74 of them cannot do
 * schema-constrained output, so it is the one provider that publishes real per-model metadata — and
 * the capability resolver consults it rather than assuming, exactly as before.
 */

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const BASE_URL = 'https://openrouter.ai/api/v1';

const CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  // The whole reason per-model metadata exists in this codebase. Never assumed for OpenRouter.
  json: 'per-model',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'per-model',
  largeContext: 'per-model',
  jsonStrategy: 'json-schema',
  typicalContext: 128_000,
};

export const openRouterDescriptor: ProviderDescriptor = {
  id: 'openrouter',
  label: 'OpenRouter',
  auth: 'api-key',
  keyUrl: 'https://openrouter.ai/keys',
  baseUrl: BASE_URL,
  defaultModel: 'openai/gpt-oss-20b:free',
  local: false,
  capabilities: CAPABILITIES,
  discovery: 'catalogue',
};

export interface OpenRouterOptions {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  /** Sent as HTTP-Referer/X-Title, which OpenRouter uses for attribution. Not sensitive. */
  readonly appUrl?: string;
  readonly appName?: string;
  readonly baseUrl?: string;
}

/**
 * OpenRouter answers 404 when a model slug does not resolve, and slugs are retired as providers
 * rotate their line-ups — so the hint names the real cause rather than leaving "HTTP 404".
 */
function describeStatus(status: number, model: string): string | null {
  if (status !== 404) return null;
  return `The model id "${model}" was not accepted by OpenRouter. Model ids are retired over time — check Settings against the current list at https://openrouter.ai/models.`;
}

export function createOpenRouterProvider(options: OpenRouterOptions): AIProvider {
  const headers: Record<string, string> = {};
  if (options.appUrl !== undefined) headers['HTTP-Referer'] = options.appUrl;
  if (options.appName !== undefined) headers['X-Title'] = options.appName;

  return createOpenAiCompatibleProvider({
    id: 'openrouter',
    baseUrl: options.baseUrl ?? BASE_URL,
    apiKey: options.apiKey,
    jsonStrategy: 'json-schema',
    maxContext: CAPABILITIES.typicalContext,
    headers,
    describeStatus,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

export const openRouterRegistration: ProviderRegistration = {
  descriptor: openRouterDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl, appMeta }) =>
    createOpenRouterProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      ...(appMeta?.url === undefined ? {} : { appUrl: appMeta.url }),
      ...(appMeta?.name === undefined ? {} : { appName: appMeta.name }),
    }),
};
