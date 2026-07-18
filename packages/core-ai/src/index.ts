/**
 * @fixora/core-ai — the AI repair layer. Pure TS, no Electron, no React.
 *
 * Phase A surface: the secret gate (the single outbound choke point) and the provider abstraction
 * with its OpenRouter (BYOK) adapter. Context building, task profiles, and verification land in the
 * following phases behind these same boundaries.
 */

export {
  gate,
  type GateMatch,
  type GateMatchKind,
  type GatePart,
  type GateResult,
} from './gate/secret-gate.js';
export { isDeniedPath } from './gate/paths.js';
export { hasHighEntropySecret, shannonEntropy } from './gate/entropy.js';
export { SECRET_PATTERNS, type SecretPattern } from './gate/patterns.js';

export {
  createOpenRouterProvider,
  OPENROUTER_ENDPOINT,
  type FetchLike,
  type OpenRouterOptions,
} from './provider/openrouter.js';
export type {
  AIProvider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderMessage,
  ProviderRequest,
  ProviderRole,
  ResponseSchema,
} from './provider/types.js';

export {
  DEFAULT_BUDGETS,
  estimateTokens,
  inputBudget,
  type TokenBudget,
} from './context/budget.js';
export {
  buildContext,
  type BuiltContext,
  type BuiltTarget,
  type ContextInput,
  type TargetRange,
} from './context/context-builder.js';
export {
  buildProviderRequest,
  profileWantsStructuredOutput,
  type BuildRequestOptions,
} from './profiles/profiles.js';
export {
  parseRepairOutput,
  parseTestOutput,
  REPAIR_JSON_SCHEMA,
  TEST_JSON_SCHEMA,
  type ParseResult,
} from './profiles/schemas.js';
export { prepareRequest, type PreparedRequest } from './pipeline/prepare.js';
