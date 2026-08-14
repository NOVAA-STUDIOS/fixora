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
} from './provider/adapters/openrouter.js';
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
export { keyFingerprint } from './provider/adapters/openai-compatible.js';

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
  buildVerificationReAskMessage,
  buildLintOnlyReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
  describeTimeoutFailure,
  severityOf,
  type FailureKind,
  type ProviderFailure,
} from './provider/failure.js';
export {
  allDescriptors,
  allProviders,
  DEFAULT_PROVIDER_ID,
  providerDescriptor,
  providerRegistration,
} from './provider/catalog.js';
export {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from './provider/adapters/openai-compatible.js';
export {
  createOpenAiProvider,
  openAiDescriptor,
  openAiRegistration,
} from './provider/adapters/openai.js';
export {
  openRouterDescriptor,
  openRouterRegistration,
} from './provider/adapters/openrouter.js';
export {
  MIN_REPAIR_CONTEXT,
  resolveCapabilities,
  supportsCodeRepair,
  supportsProfile,
  type CapabilitySupport,
  type JsonStrategy,
  type ModelFacts,
  type ProviderCapabilityMatrix,
  type ResolvedCapabilities,
} from './provider/capability.js';
export {
  estimateComplexity,
  rankModelsForTask,
  selectBestModel,
  type ComplexityInput,
  type RepairComplexity,
  type RoutingTask,
} from './provider/routing.js';
export type {
  ModelDiscovery,
  ProviderAuthKind,
  ProviderDescriptor,
  ProviderRegistration,
} from './provider/descriptor.js';
export {
  buildFailoverChain,
  FAILOVER_CATEGORIES,
  failoverScope,
  runWithFailover,
  shouldFailover,
  type FailoverAttemptRecord,
  type RetryAttemptRecord,
  type FailoverAttemptResult,
  type FailoverCandidate,
  type FailoverOutcome,
  type FailoverScope,
  type FailoverStopReason,
} from './provider/failover.js';
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
