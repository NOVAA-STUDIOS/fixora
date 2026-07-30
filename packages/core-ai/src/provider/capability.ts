import type { TaskProfile } from '@fixora/shared-types';

/**
 * The provider capability matrix.
 *
 * Fixora's existing rule is that a capability is **read, never assumed** — asserting
 * `structuredOutput: true` on the provider once made every repair fail for the 74 OpenRouter models
 * that cannot do it, and users discovered that by pressing Repair and watching it break.
 *
 * That rule cannot survive contact with five providers unchanged, and pretending otherwise would be
 * the dishonest move. OpenRouter publishes per-model `supported_parameters`; OpenAI, Anthropic and
 * Google publish nothing equivalent; Ollama's `/api/tags` returns names and sizes with no capability
 * flags at all. There is simply no metadata to read for four of the five.
 *
 * So the rule is weakened deliberately and *narrowly*, and the weakening is made visible rather than
 * hidden. Every capability answer carries a `basis` string saying where it came from:
 *
 *  - `'per-model'` means the provider publishes real metadata and it must be consulted. Nothing is
 *    assumed; this is the old behaviour, preserved exactly where it is available.
 *  - `'yes'`/`'no'` mean the PROVIDER guarantees it for every model it serves. That is a documented
 *    platform property (Anthropic serves tool-use on every current model), not a guess about a model.
 *
 * The distinction matters because it decides who is accountable when it is wrong: `per-model` wrong
 * means the provider's metadata lied; `yes` wrong means we did. Recording which one we relied on is
 * what keeps that honest.
 */

/** Tri-state, because "the provider guarantees it" and "ask the model" are different claims. */
export type CapabilitySupport =
  /** Guaranteed by the provider for every model it serves. */
  | 'yes'
  /** Not offered by this provider at all. */
  | 'no'
  /** Varies; the provider publishes per-model metadata that must be consulted. */
  | 'per-model';

/**
 * How a provider can be made to emit JSON conforming to a schema.
 *
 * Declared here rather than inferred in the adapter because the orchestrator needs to know *whether*
 * a candidate can do it before spending a request, while the adapter needs to know *how* to ask.
 * One declaration, two readers.
 */
export type JsonStrategy =
  /** OpenAI-style `response_format: { type: 'json_schema' }`. Strict, schema-enforced. */
  | 'json-schema'
  /** Anthropic-style: declare a tool whose input IS the schema, and force `tool_choice`. */
  | 'tool-use'
  /** Google-style `responseMimeType` + `responseSchema`. */
  | 'response-mime'
  /** Best-effort JSON with no schema enforcement (Ollama's `format: json`). */
  | 'json-object'
  /** Cannot be asked for JSON at all. */
  | 'none';

export interface ProviderCapabilityMatrix {
  readonly streaming: CapabilitySupport;
  readonly json: CapabilitySupport;
  readonly reasoning: CapabilitySupport;
  readonly images: CapabilitySupport;
  readonly functionCalling: CapabilitySupport;
  readonly largeContext: CapabilitySupport;
  /** How JSON is requested, when `json` is not `'no'`. */
  readonly jsonStrategy: JsonStrategy;
  /** Context window of the provider's typical model, in tokens. Per-model metadata overrides it. */
  readonly typicalContext: number;
}

/** What a specific model can do, once per-model metadata (where it exists) has been applied. */
export interface ResolvedCapabilities {
  readonly json: boolean;
  readonly streaming: boolean;
  readonly contextLength: number;
  /** Where each answer came from — provider guarantee, or the provider's own per-model metadata. */
  readonly basis: string;
}

/** Per-model facts, when the provider publishes them. All optional: most providers publish none. */
export interface ModelFacts {
  readonly id: string;
  readonly structuredOutput?: boolean;
  readonly contextLength?: number | null;
}

/** A repair needs at least this much context to be worth attempting. */
export const MIN_REPAIR_CONTEXT = 8_000;

/**
 * Resolve a matrix against a specific model.
 *
 * `'per-model'` consults `facts` and refuses when they are missing — the failure mode being avoided
 * is an action that looks available and is not, so absence of evidence resolves to unsupported
 * rather than to optimism.
 */
export function resolveCapabilities(
  matrix: ProviderCapabilityMatrix,
  facts: ModelFacts | null,
): ResolvedCapabilities {
  const json =
    matrix.json === 'yes'
      ? true
      : matrix.json === 'no'
        ? false
        : (facts?.structuredOutput ?? false);

  const basis =
    matrix.json === 'per-model'
      ? facts === null
        ? 'no per-model metadata available'
        : `provider lists structured output: ${String(facts.structuredOutput ?? false)}`
      : `provider guarantees JSON support: ${matrix.json}`;

  return {
    json,
    streaming: matrix.streaming === 'yes' || (matrix.streaming === 'per-model' && facts !== null),
    contextLength: facts?.contextLength ?? matrix.typicalContext,
    basis,
  };
}

/**
 * Can this provider/model do a code repair?
 *
 * **Derived, never declared.** "Supports code repair" is not an independent fact a provider can
 * assert — it is exactly "can stream, can be made to emit schema-conforming JSON, and has room for
 * the prompt". Deriving it keeps one rule in one place; declaring it per provider would be five
 * hand-maintained booleans that drift out of agreement with the three facts underneath them.
 */
export function supportsCodeRepair(resolved: ResolvedCapabilities): boolean {
  return resolved.json && resolved.streaming && resolved.contextLength >= MIN_REPAIR_CONTEXT;
}

/** Which profiles this provider/model can serve. `analyze` never reaches a model (ADR-002). */
export function supportsProfile(profile: TaskProfile, resolved: ResolvedCapabilities): boolean {
  // `repair` and `test` write structured output that lands in source files; `explain` is free text
  // and any model that can complete can do it.
  if (profile === 'explain') return resolved.streaming;
  return supportsCodeRepair(resolved);
}
