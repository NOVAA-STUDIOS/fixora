import type { TaskProfile } from '@fixora/shared-types';

import type { BuiltContext } from '../context/context-builder.js';
import { gate, type GateMatch } from '../gate/secret-gate.js';
import { buildProviderRequest, type BuildRequestOptions } from '../profiles/profiles.js';
import type { ProviderRequest } from '../provider/types.js';

/**
 * The single path from context to a provider request — and the reason the gate cannot be bypassed.
 *
 * Every AI request in the app is built here, and this function runs the secret gate over the context's
 * parts *before* it will hand anything to a provider. There is no other constructor of a
 * `ProviderRequest` used by the pipeline, so "nothing leaves without passing the gate" is a structural
 * property, not a discipline someone has to remember (AI-Pipeline §2). A block returns the matches —
 * which file, which rule — so the caller can tell the user exactly what stopped the send.
 */

export type PreparedRequest =
  | { readonly ok: false; readonly blocked: readonly GateMatch[] }
  | { readonly ok: true; readonly request: ProviderRequest };

export function prepareRequest(
  profile: TaskProfile,
  context: BuiltContext,
  options: BuildRequestOptions,
): PreparedRequest {
  const gateResult = gate(context.parts);
  if (!gateResult.ok) {
    return { ok: false, blocked: gateResult.matches };
  }
  return { ok: true, request: buildProviderRequest(profile, context, options) };
}
