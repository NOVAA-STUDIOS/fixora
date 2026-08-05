import type { ProviderCapabilityMatrix } from '../capability.js';
import type { ProviderDescriptor, ProviderRegistration } from '../descriptor.js';
import type { AIProvider } from '../types.js';

import { createOpenAiCompatibleProvider, type FetchLike } from './openai-compatible.js';

/**
 * Azure OpenAI.
 *
 * Same protocol as OpenAI, three differences that all live in configuration:
 *
 *  1. **The base URL is per-tenant.** There is no shared host — every organisation gets
 *     `https://<resource>.openai.azure.com/openai/deployments/<deployment>`. The descriptor default
 *     is therefore a placeholder that CANNOT work unmodified, and the UI must make the user set it.
 *     That is honest: an Azure integration that pretends to have a default endpoint is lying.
 *  2. **The credential is a header, not a bearer token** — `api-key: <key>` rather than
 *     `Authorization: Bearer`. Azure rejects the bearer form outright.
 *  3. **The model is the DEPLOYMENT name**, chosen by whoever provisioned the resource, not a
 *     vendor model id. `gpt-4o` may be deployed as `prod-gpt4o`; only the tenant knows.
 *
 * None of that needs a wire adapter, which is the point: the OpenAI-compatible core carries it.
 */

/**
 * A deliberately invalid placeholder.
 *
 * Azure has no shared endpoint, so any concrete default would be wrong for every user. This one is
 * obviously a template rather than a hostname that might half-work, so the failure is "you have not
 * configured this yet" instead of a confusing DNS error.
 */
const BASE_URL_TEMPLATE = 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT';

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

export const azureOpenAiDescriptor: ProviderDescriptor = {
  id: 'azure-openai',
  label: 'Azure OpenAI',
  auth: 'api-key',
  keyUrl: 'https://portal.azure.com',
  dashboardUrl: 'https://portal.azure.com',
  baseUrl: BASE_URL_TEMPLATE,
  // The DEPLOYMENT name, which is tenant-specific. Another honest placeholder.
  defaultModel: 'your-deployment',
  local: false,
  capabilities: CAPABILITIES,
  // Azure's model list is per-resource and needs a management-plane call, not the inference key.
  discovery: 'static',
  /**
   * Empty ON PURPOSE, and not an omission to be filled in later.
   *
   * Azure addresses DEPLOYMENTS, which are names the user invented in their own resource — there is
   * no vendor list to curate, and shipping model ids here would offer names that are wrong for every
   * subscriber. The live listing against their endpoint is the only truthful source.
   */
  models: [],
};

function describeStatus(status: number, model: string): string | null {
  if (status === 404) {
    return `Azure has no deployment called "${model}" at this endpoint. Check the deployment name and the resource URL in Settings — Azure uses your DEPLOYMENT name, not the model name.`;
  }
  if (status === 401 || status === 403) {
    return 'Azure rejected the key. Azure keys are per-resource — check you are using the key for this exact resource.';
  }
  return null;
}

export interface AzureOpenAiOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
  /** Azure requires an explicit API version on every request. */
  readonly apiVersion?: string;
}

/** The API version Azure requires. Current GA at time of writing; overridable per install. */
const DEFAULT_API_VERSION = '2024-10-21';

export function createAzureOpenAiProvider(options: AzureOpenAiOptions): AIProvider {
  const version = options.apiVersion ?? DEFAULT_API_VERSION;
  return createOpenAiCompatibleProvider({
    id: 'azure-openai',
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    // Azure requires api-version on every request. It travels through `query` rather than on the
    // base URL because endpoints are built by appending a path (`/chat/completions`), which would
    // otherwise land AFTER the '?' and produce a URL that 404s.
    query: `api-version=${version}`,
    // Passed so the compatible core does not add an Authorization header (Azure ignores it), while
    // the real credential travels in the `api-key` header below.
    apiKey: null,
    headers: { 'api-key': options.apiKey },
    jsonStrategy: 'json-schema',
    maxContext: CAPABILITIES.typicalContext,
    describeStatus,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

export const azureOpenAiRegistration: ProviderRegistration = {
  descriptor: azureOpenAiDescriptor,
  create: ({ apiKey, baseUrl, fetchImpl }) =>
    createAzureOpenAiProvider({
      apiKey: apiKey ?? '',
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetchImpl: fetchImpl }),
    }),
};
