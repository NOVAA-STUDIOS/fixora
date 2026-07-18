import { hasHighEntropySecret } from './entropy.js';
import { isDeniedPath } from './paths.js';
import { SECRET_PATTERNS } from './patterns.js';

/**
 * The secret gate — the single choke point every outbound payload passes through (AI-Pipeline §2).
 *
 * "Nothing leaves the machine without passing this. One choke point. No exceptions, no bypass flag,
 * no 'just for debugging'." This is the control that prevents the extinction-level risk in the PRD:
 * one incident of Fixora sending a customer's key to a provider and the product thesis — *trust us
 * with your code* — is dead. So the gate **fails closed**: any match blocks, and the result names
 * which part and which rule, so the user gets an honest, specific refusal — never a silent
 * redact-and-send, never a "send anyway" button someone clicks at 6pm on a Friday.
 *
 * The result never carries the matched secret. We report the rule id and the part label; the bytes
 * that tripped the gate do not travel onward, not even into our own logs.
 */

/** One labelled piece of an outbound payload — a file slice, the evidence, a neighbour symbol. */
export interface GatePart {
  /** Where this text came from: a workspace-relative path, or a descriptor like 'evidence:eslint'. */
  readonly label: string;
  readonly text: string;
}

export type GateMatchKind = 'path' | 'content' | 'entropy';

export interface GateMatch {
  readonly label: string;
  /** The rule that fired: a pattern id, 'denied-path', or 'high-entropy'. */
  readonly rule: string;
  readonly kind: GateMatchKind;
}

export type GateResult =
  { readonly ok: true } | { readonly ok: false; readonly matches: GateMatch[] };

export function gate(parts: readonly GatePart[]): GateResult {
  const matches: GateMatch[] = [];

  for (const part of parts) {
    if (isDeniedPath(part.label)) {
      matches.push({ label: part.label, rule: 'denied-path', kind: 'path' });
      // A denied file should never have been read; don't also scan its bytes. Move on.
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(part.text)) {
        matches.push({ label: part.label, rule: pattern.id, kind: 'content' });
      }
    }

    if (hasHighEntropySecret(part.text)) {
      matches.push({ label: part.label, rule: 'high-entropy', kind: 'entropy' });
    }
  }

  return matches.length === 0 ? { ok: true } : { ok: false, matches };
}
