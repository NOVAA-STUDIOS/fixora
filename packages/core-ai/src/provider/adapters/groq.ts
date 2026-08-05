import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import type { AIProvider } from '../types.js';

import { createOpenAiCompatibleProvider, type FetchLike } from './openai-compatible.js';

/**
 * Groq.
 *
 * Serves the OpenAI chat-completions protocol, so this is a descriptor and a factory — **no wire
 * adapter**. That is the architecture's claim being cashed rather than a shortcut: OpenAI,
 * OpenRouter, Azure, Ollama and LM Studio already share `openai-compatible.ts`, and Groq joins them
 * for the same reason. Writing a bespoke Groq adapter would mean maintaining a second copy of the
 * SSE parsing, the error-body handling and the rate-limit extraction, all to reach the same endpoint
 * shape.
 *
 * `json: 'per-model'` rather than `'yes'`: Groq's structured-output support varies by the model
 * served — the Llama and Qwen families it hosts differ — and claiming a platform-wide guarantee we
 * cannot honour would let the capability gate admit a model that then fails at generation time.
 * Under `per-model`, `resolveCapabilities` consults the model facts and falls back conservatively.
 */

const BASE_URL = 'https://api.groq.com/openai/v1';

const CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  json: 'per-model',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'per-model',
  largeContext: 'per-model',
  // `json-object` rather than `json-schema`: Groq accepts `response_format: {type:'json_object'}`
  // far more widely than a full schema, and a schema an engine cannot enforce is a hard 400 rather
  // than a degraded answer. The repair parser and the verifier already handle a model that ignores
  // the shape it was asked for.
  jsonStrategy: 'json-object',
  typicalContext: 32_768,
};

export const groqDescriptor: ProviderDescriptor = {
  id: 'groq',
  label: 'Groq',
  auth: 'api-key',
  keyUrl: 'https://console.groq.com/keys',
  dashboardUrl: 'https://console.groq.com/settings/billing',
  baseUrl: BASE_URL,
  defaultModel: 'llama-3.3-70b-versatile',
  local: false,
  capabilities: CAPABILITIES,
  // `/openai/v1/models` returns ids with no capability metadata, exactly like OpenAI's.
  discovery: 'id-list',
};

/** Groq's 404 means the model is not served here, which reads very differently from "wrong URL". */
function describeStatus(status: number, model: string): string | null {
  if (status === 404) {
    return `Groq does not serve a model called "${model}". Its catalogue changes as models are added and retired — pick another in Settings.`;
  }
  if (status === 413) {
    return 'The request was larger than Groq accepts for this model. Try a smaller repair scope.';
  }
  return null;
}

export interface GroqOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
}

export function createGroqProvider(options: GroqOptions): AIProvider {
  return createOpenAiCompatibleProvider({
    id: 'groq',
    baseUrl: options.baseUrl ?? BASE_URL,
    apiKey: options.apiKey,
    jsonStrategy: 'json-object',
    maxContext: CAPABILITIES.typicalContext,
    describeStatus,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

export const groqRegistration: ProviderRegistration = {
  descriptor: groqDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl }) =>
    createGroqProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl: fetchImpl as FetchLike }),
    }),
};
