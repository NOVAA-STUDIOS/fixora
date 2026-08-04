import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import type { AIProvider } from '../types.js';

import { createOpenAiCompatibleProvider, type FetchLike } from './openai-compatible.js';

/**
 * OpenAI — the adapter that proves the architecture.
 *
 * It is deliberately this short. If adding a provider required more than a descriptor and a factory,
 * the platform would not have achieved what it set out to; the fact that OpenAI is ~40 lines of
 * configuration is the evidence, not a convenience.
 *
 * `json: 'yes'` rather than `'per-model'`: OpenAI serves structured outputs on every current
 * chat-completions model, which is a documented platform guarantee rather than an assumption about
 * an individual model. `/v1/models` returns ids with no capability flags, so there is no per-model
 * metadata to consult even if we wanted to — and the capability resolver records that basis so the
 * UI can say where its answer came from.
 */

const BASE_URL = 'https://api.openai.com/v1';

const CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  json: 'yes',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'yes',
  largeContext: 'yes',
  jsonStrategy: 'json-schema',
  typicalContext: 128_000,
};

export const openAiDescriptor: ProviderDescriptor = {
  id: 'openai',
  label: 'OpenAI',
  auth: 'api-key',
  keyUrl: 'https://platform.openai.com/api-keys',
  dashboardUrl: 'https://platform.openai.com/usage',
  baseUrl: BASE_URL,
  defaultModel: 'gpt-4.1-mini',
  local: false,
  capabilities: CAPABILITIES,
  // `/v1/models` lists ids, with no capability metadata attached.
  discovery: 'id-list',
};

export interface OpenAiOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  /** Sent as `OpenAI-Organization` when set. Not sensitive. */
  readonly organization?: string;
}

/** OpenAI answers 404 for a model the account cannot see, which reads as "does not exist". */
function describeStatus(status: number, model: string): string | null {
  if (status !== 404) return null;
  return `OpenAI does not offer "${model}" to this account. Some models require a paid tier or verified organisation.`;
}

export function createOpenAiProvider(options: OpenAiOptions): AIProvider {
  const headers: Record<string, string> = {};
  if (options.organization !== undefined) headers['OpenAI-Organization'] = options.organization;

  return createOpenAiCompatibleProvider({
    id: 'openai',
    baseUrl: options.baseUrl ?? BASE_URL,
    apiKey: options.apiKey,
    jsonStrategy: 'json-schema',
    maxContext: CAPABILITIES.typicalContext,
    headers,
    describeStatus,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

export const openAiRegistration: ProviderRegistration = {
  descriptor: openAiDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl }) =>
    createOpenAiProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    }),
};
