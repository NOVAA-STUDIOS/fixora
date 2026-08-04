
import { azureOpenAiRegistration } from './adapters/azure-openai.js';
import { lmStudioRegistration, ollamaRegistration } from './adapters/local.js';
import { openAiRegistration } from './adapters/openai.js';
import { openRouterRegistration } from './adapters/openrouter.js';
import type { ProviderDescriptor, ProviderRegistration } from './descriptor.js';

/**
 * The provider catalog — the one place a provider is registered.
 *
 * This array IS the extension point. Adding a provider means writing an adapter file and adding one
 * entry here; nothing else in Fixora names a provider. The orchestrator iterates, Settings iterates,
 * the credential store keys off `descriptor.id`, and the repair pipeline never sees any of it.
 *
 * Ordering here is the DEFAULT priority for a fresh install, not the user's. Once a user has ordered
 * their providers, the registry stored on their machine decides and this order is irrelevant.
 */
const REGISTRATIONS: readonly ProviderRegistration[] = [
  // OpenRouter first: it is the default, and every existing user is already on it.
  openRouterRegistration,
  openAiRegistration,
  azureOpenAiRegistration,
  // Local providers last in the DEFAULT order, not because they matter least — they are the most
  // private option available — but because they only work once the user has a daemon running, and a
  // fresh install has neither. A user who wants them first moves them up, and that order persists.
  ollamaRegistration,
  lmStudioRegistration,
];

export function allProviders(): readonly ProviderRegistration[] {
  return REGISTRATIONS;
}

export function allDescriptors(): readonly ProviderDescriptor[] {
  return REGISTRATIONS.map((registration) => registration.descriptor);
}

export function providerRegistration(id: string): ProviderRegistration | null {
  return REGISTRATIONS.find((registration) => registration.descriptor.id === id) ?? null;
}

export function providerDescriptor(id: string): ProviderDescriptor | null {
  return providerRegistration(id)?.descriptor ?? null;
}

/** The provider a fresh install starts on. */
export const DEFAULT_PROVIDER_ID = 'openrouter';
