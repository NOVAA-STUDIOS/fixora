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
export {
  CATALOGUE_ENDPOINT,
  NO_FREE_MODELS_MESSAGE,
  PREFERRED_FREE_CODE_MODELS,
  fetchModelCatalogue,
  isModelAvailable,
  pickDefaultModel,
  toCatalogueModel,
  type CatalogueModel,
} from './provider/catalogue.js';
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
  parseEditOutput,
  REPAIR_JSON_SCHEMA,
  TEST_JSON_SCHEMA,
  EDIT_JSON_SCHEMA,
  type ParseResult,
} from './profiles/schemas.js';
export { prepareRequest, type PreparedRequest } from './pipeline/prepare.js';

// Proceed Mode (P2.1) — the editing pipeline. A parallel, additive path that reuses the repair
// engine's gate/budget/provider/parse primitives; the repair path above is untouched.
export { classifyIntent, type IntentResult } from './edit/intent.js';
export {
  buildEditContext,
  type EditContext,
  type EditContextInput,
  type EditTarget,
} from './edit/edit-context.js';
export {
  buildEditRequest,
  prepareEditRequest,
  type BuildEditRequestOptions,
  type PreparedEdit,
} from './edit/edit-request.js';
export {
  buildReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
  describeTimeoutFailure,
  severityOf,
  type FailureKind,
  type ProviderFailure,
} from './provider/failure.js';
export {
  FAILURE_LAYER_LABEL,
  FAILURE_STATUS_LABEL,
  RECOVERY_ACTION_LABEL,
  type FailureCategory,
  type FailureLayer,
  type FailureSeverity,
  type RecoveryAction,
} from './provider/failure-model.js';
export {
  capabilitiesFor,
  suggestCapableModel,
  type ModelCapabilities,
  type ProfileSupport,
} from './provider/capabilities.js';
