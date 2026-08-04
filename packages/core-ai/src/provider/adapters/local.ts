import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import type { AIProvider } from '../types.js';

import { createOpenAiCompatibleProvider, type FetchLike } from './openai-compatible.js';

/**
 * Local providers — Ollama and LM Studio.
 *
 * Both serve the OpenAI chat-completions protocol on localhost, so neither needs a wire adapter: a
 * descriptor with a different base URL is the whole integration. That is the architecture working as
 * intended rather than a shortcut.
 *
 * What makes them different from every cloud provider is not the protocol, it is the trust model:
 * inference happens on the user's machine, no credential exists, and **no code leaves the device**.
 * For a tool whose input is the user's source, that is the strongest privacy position available, and
 * it is why `local: true` and `auth: 'none'` are the load-bearing fields here.
 *
 * ## Capabilities are claimed conservatively
 *
 * A local daemon serves whatever model the user pulled, and a 3B quantised model is not going to
 * honour a JSON schema reliably. `json: 'per-model'` says so honestly instead of promising structured
 * output the runtime cannot deliver — the capability resolver then keeps an incapable local model out
 * of the Repair chain rather than letting it fail at generation time.
 */

const OLLAMA_BASE = 'http://127.0.0.1:11434/v1';
const LM_STUDIO_BASE = 'http://127.0.0.1:1234/v1';

/**
 * Shared local capability profile.
 *
 * `jsonStrategy: 'json-object'`, not `'json-schema'`: llama.cpp-backed runtimes accept
 * `response_format: {type: 'json_object'}` far more widely than they honour a full schema, and
 * asking for a schema an engine cannot enforce produces a hard 400 rather than a degraded answer.
 * The repair parser and the verifier already handle a model that ignores the shape it was given.
 */
const LOCAL_CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  json: 'per-model',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'per-model',
  largeContext: 'per-model',
  jsonStrategy: 'json-object',
  // Deliberately modest: local context is bounded by the user's RAM, not by a vendor's ceiling.
  typicalContext: 8_192,
};

/** A local endpoint refusing the connection means the daemon is not running — the common case. */
function describeLocalStatus(label: string, port: string) {
  return (status: number, model: string): string | null => {
    if (status === 404) {
      return `${label} is running but has no model called "${model}". Pull or load it first, then try again.`;
    }
    if (status === 400) {
      return `${label} rejected the request for "${model}". A small or heavily quantised model may not support structured output.`;
    }
    return `Check that ${label} is running and listening on port ${port}.`;
  };
}

export const ollamaDescriptor: ProviderDescriptor = {
  id: 'ollama',
  label: 'Ollama (local)',
  auth: 'none',
  baseUrl: OLLAMA_BASE,
  // Ollama's own naming. The user's actual pulled models are discovered at runtime.
  defaultModel: 'qwen2.5-coder:7b',
  local: true,
  capabilities: LOCAL_CAPABILITIES,
  discovery: 'local',
};

export const lmStudioDescriptor: ProviderDescriptor = {
  id: 'lmstudio',
  label: 'LM Studio (local)',
  auth: 'none',
  baseUrl: LM_STUDIO_BASE,
  // LM Studio serves whatever is loaded in the UI; this is a placeholder the picker replaces.
  defaultModel: 'local-model',
  local: true,
  capabilities: LOCAL_CAPABILITIES,
  discovery: 'local',
};

function createLocalProvider(
  id: string,
  label: string,
  port: string,
  baseUrl: string,
  fetchImpl?: FetchLike,
): AIProvider {
  return createOpenAiCompatibleProvider({
    id,
    baseUrl,
    // No credential: the daemon is on the user's own machine, and demanding a key to reach it would
    // be security theatre. `openai-compatible` omits the Authorization header entirely for null.
    apiKey: null,
    jsonStrategy: 'json-object',
    maxContext: LOCAL_CAPABILITIES.typicalContext,
    describeStatus: describeLocalStatus(label, port),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
}

export const ollamaRegistration: ProviderRegistration = {
  descriptor: ollamaDescriptor,
  create: ({ baseUrl, fetchImpl }) =>
    createLocalProvider('ollama', 'Ollama', '11434', baseUrl, fetchImpl as FetchLike | undefined),
};

export const lmStudioRegistration: ProviderRegistration = {
  descriptor: lmStudioDescriptor,
  create: ({ baseUrl, fetchImpl }) =>
    createLocalProvider(
      'lmstudio',
      'LM Studio',
      '1234',
      baseUrl,
      fetchImpl as FetchLike | undefined,
    ),
};
