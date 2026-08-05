import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import { readRateLimit } from '../rate-limit.js';
import type {
  AIProvider,
  ProviderEvent,
  ProviderRequest,
  ProviderTestResult,
} from '../types.js';

import { keyFingerprint, type FetchLike } from './openai-compatible.js';
import { readSseStream, sseData } from './sse.js';

/**
 * Google Gemini, via the Generative Language API.
 *
 * The furthest from the OpenAI shape of the three, in four ways that all matter:
 *
 *  1. **The model is in the URL PATH, not the body** — `/models/{model}:streamGenerateContent`.
 *     A wrong model id is therefore a 404 on a URL rather than a field-level error.
 *  2. **Roles are `user` and `model`**, not `user`/`assistant`. Sending `assistant` is a 400.
 *  3. **System text is `systemInstruction`**, a sibling of `contents` — same structural split as
 *     Anthropic, different field name.
 *  4. **Text lives in `candidates[].content.parts[].text`**, and a single SSE frame can carry
 *     several parts, so a frame yields zero-to-many deltas rather than exactly one.
 *
 * The credential goes in the `x-goog-api-key` HEADER, deliberately not the `?key=` query parameter
 * the quickstart shows: a key in a URL lands in proxy logs, crash reports and shell history, and
 * this one is the user's. The header form is equally supported and does not leak that way.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const CAPABILITIES: ProviderCapabilityMatrix = {
  streaming: 'yes',
  // Gemini supports `responseMimeType: application/json` plus a schema on current models, which is
  // a genuine platform guarantee rather than a per-model accident.
  json: 'yes',
  reasoning: 'per-model',
  images: 'per-model',
  functionCalling: 'yes',
  largeContext: 'yes',
  jsonStrategy: 'json-schema',
  typicalContext: 1_000_000,
};

export const geminiDescriptor: ProviderDescriptor = {
  id: 'gemini',
  label: 'Google Gemini',
  auth: 'api-key',
  keyUrl: 'https://aistudio.google.com/apikey',
  dashboardUrl: 'https://aistudio.google.com/usage',
  baseUrl: BASE_URL,
  defaultModel: 'gemini-2.5-flash',
  local: false,
  capabilities: CAPABILITIES,
  discovery: 'id-list',
};

interface GeminiFrame {
  candidates?: readonly {
    content?: { parts?: readonly { text?: unknown }[] };
    finishReason?: unknown;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { code?: unknown; message?: unknown; status?: unknown };
}

/**
 * Translate Fixora's neutral request into Gemini's shape.
 *
 * Exported for tests: the role mapping and the system split are the two things most likely to break
 * silently — a wrong role is a 400, and a dropped system prompt produces a plausible-looking repair
 * generated without any of its instructions.
 */
export function toGeminiBody(request: ProviderRequest): Record<string, unknown> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const contents = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      // Gemini's assistant role is literally called `model`. Sending `assistant` is a 400.
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {};
  if (request.maxOutputTokens !== undefined) {
    generationConfig['maxOutputTokens'] = request.maxOutputTokens;
  }
  if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
  if (request.responseSchema !== undefined) {
    generationConfig['responseMimeType'] = 'application/json';
    generationConfig['responseSchema'] = request.responseSchema.schema;
  }

  const body: Record<string, unknown> = { contents };
  if (system !== '') body['systemInstruction'] = { parts: [{ text: system }] };
  if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;
  return body;
}

/** Gemini's error body: `{error:{code, message, status}}`. */
function readErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as GeminiFrame;
    const message = parsed.error?.message;
    return typeof message === 'string' ? message.slice(0, 300) : raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

function describeStatus(status: number, model: string): string | null {
  if (status === 404) {
    return `Gemini has no model called "${model}". The id is part of the request URL, so a typo reads as "not found" — check it in Settings.`;
  }
  if (status === 400) {
    return 'Gemini rejected the request. A key restricted to specific APIs or referrers will also fail this way.';
  }
  if (status === 403) {
    return 'Gemini refused the key. Check that the Generative Language API is enabled for this project and the key is unrestricted.';
  }
  return null;
}

export interface GeminiOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
}

export function createGeminiProvider(options: GeminiOptions): AIProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = (options.baseUrl ?? BASE_URL).replace(/\/+$/, '');

  function headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // Header, never `?key=` — a credential in a URL leaks into logs and history.
      'x-goog-api-key': options.apiKey,
    };
  }

  function* handleLine(line: string): Iterable<ProviderEvent> {
    const data = sseData(line);
    if (data === null) return;

    let frame: GeminiFrame;
    try {
      frame = JSON.parse(data) as GeminiFrame;
    } catch {
      return;
    }

    // A single frame can carry several parts, so this is zero-to-many deltas, not exactly one.
    for (const candidate of frame.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { type: 'text_delta', text: part.text };
        }
      }
    }

    const usage = frame.usageMetadata;
    if (usage !== undefined) {
      yield {
        type: 'usage',
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
      };
    }
  }

  async function* stream(
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    // The model rides in the path, and `alt=sse` is what makes the response line-delimited SSE
    // rather than a single streamed JSON array.
    const url = `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    let response: Response;
    console.error('[provider] request', {
      provider: 'gemini',
      baseUrl: base,
      model: request.model,
      key: keyFingerprint(options.apiKey),
    });
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(toGeminiBody(request)),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return;
      console.error('[provider] FAILED — request did not reach the provider', {
        provider: 'gemini',
        reachedProvider: false,
        errorOrigin: 'fixora',
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NETWORK',
        message: error instanceof Error ? error.name : 'network error',
      };
      return;
    }

    if (!response.ok) {
      const raw = await response.clone().text();
      const detail = readErrorMessage(raw);
      const hint = describeStatus(response.status, request.model);
      const rateLimit = readRateLimit(response.headers, raw);
      console.error('[provider] FAILED — the provider refused the request', {
        provider: 'gemini',
        model: request.model,
        key: keyFingerprint(options.apiKey),
        reachedProvider: true,
        errorOrigin: 'provider',
        status: response.status,
        statusText: response.statusText,
        body: raw.slice(0, 8000),
      });
      yield {
        type: 'error',
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `HTTP_${String(response.status)}`,
        message: [`${String(response.status)} ${response.statusText}`.trim(), detail, hint]
          .filter((part) => part !== null && part !== '')
          .join(' — '),
        status: response.status,
        ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {}),
      };
      return;
    }

    if (response.body === null) {
      yield {
        type: 'error',
        retryable: true,
        providerCode: 'NO_BODY',
        message: 'The provider accepted the request but returned no response stream.',
      };
      return;
    }

    yield* readSseStream(response.body, handleLine, signal);
  }

  async function test(model: string, signal: AbortSignal): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    try {
      const response = await doFetch(`${base}/models`, {
        method: 'GET',
        headers: headers(),
        signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        return { reachable: true, authenticated: false, modelAvailable: null, latencyMs };
      }
      if (!response.ok) {
        return { reachable: true, authenticated: true, modelAvailable: null, latencyMs };
      }
      const parsed = (await response.json()) as { models?: readonly { name?: unknown }[] };
      // Gemini reports ids as `models/gemini-2.5-flash`; the user configures the bare id.
      const models = (parsed.models ?? [])
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.replace(/^models\//, ''));
      return {
        reachable: true,
        authenticated: true,
        modelAvailable: models.length === 0 ? null : models.includes(model),
        latencyMs,
        models,
      };
    } catch {
      return {
        reachable: false,
        authenticated: null,
        modelAvailable: null,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  return {
    id: 'gemini',
    capabilities: { structuredOutput: true, maxContext: CAPABILITIES.typicalContext },
    stream,
    test,
  };
}

export const geminiRegistration: ProviderRegistration = {
  descriptor: geminiDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl }) =>
    createGeminiProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl: fetchImpl as FetchLike }),
    }),
};
