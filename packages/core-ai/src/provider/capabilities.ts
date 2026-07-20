import type { TaskProfile } from '@fixora/shared-types';

import type { CatalogueModel } from './catalogue.js';

/**
 * What a model can actually be used for, derived from the provider's own metadata.
 *
 * The rule this enforces: **a capability is read, never assumed and never hardcoded to a model
 * name.** The previous behaviour asserted `structuredOutput: true` on the *provider* — a property of
 * OpenRouter, applied to all 338 models behind it — and 74 of them cannot do it. Users on an
 * incapable model discovered that by pressing Repair and watching it fail, every time, with no way
 * to know why.
 *
 * The mapping below is about what each task *needs*, not about which models are good:
 *
 *  - `analyze` never reaches a model at all. Analysis is deterministic (ADR-002) — tree-sitter and
 *    the user's own linters — so it is available even with no key configured. It is listed here
 *    because the UI shows capabilities side by side, and omitting it would read as "unsupported".
 *  - `explain` needs only free text. Any model that can complete can do it.
 *  - `repair` and `test` need schema-constrained JSON. Without it the model returns prose or fenced
 *    markdown, which the recovery path may rescue but cannot be relied on — and `repair` writes to
 *    source files, so "may rescue" is not a standard worth shipping.
 */
export type ProfileSupport = {
  readonly supported: boolean;
  /** Why not, in one sentence, when unsupported. Rendered directly in the UI. */
  readonly reason?: string;
  /** The provider fact this decision was read from. Shown in diagnostics. */
  readonly basis: string;
};

export type ModelCapabilities = {
  readonly modelId: string;
  /** True when the provider lists structured output for this model. */
  readonly structuredOutput: boolean;
  readonly contextLength: number | null;
  readonly profiles: Readonly<Record<TaskProfile | 'analyze', ProfileSupport>>;
};

const NEEDS_SCHEMA =
  'This model does not accept a JSON schema, so it cannot return a structured repair. ' +
  'Fixora would have to guess at the shape of its reply, and a guess is not something to apply to your source files.';

export function capabilitiesFor(model: CatalogueModel | null): ModelCapabilities {
  // No model resolved yet (first run, or an unreachable catalogue). Everything that needs the
  // provider is reported unsupported rather than optimistically enabled — the whole failure mode
  // being fixed is a button that looks available and is not.
  if (model === null) {
    const unknown: ProfileSupport = {
      supported: false,
      reason: 'No model is selected yet. Choose one in Settings → AI.',
      basis: 'no model resolved',
    };
    return {
      modelId: '',
      structuredOutput: false,
      contextLength: null,
      profiles: {
        analyze: { supported: true, basis: 'deterministic — no model required' },
        explain: unknown,
        repair: unknown,
        test: unknown,
      },
    };
  }

  const schemaBasis = `provider lists structured_outputs: ${String(model.structuredOutput)}`;
  const schemaGated: ProfileSupport = model.structuredOutput
    ? { supported: true, basis: schemaBasis }
    : { supported: false, reason: NEEDS_SCHEMA, basis: schemaBasis };

  return {
    modelId: model.id,
    structuredOutput: model.structuredOutput,
    contextLength: model.contextLength,
    profiles: {
      analyze: { supported: true, basis: 'deterministic — no model required' },
      explain: { supported: true, basis: 'free-text completion; no schema needed' },
      repair: schemaGated,
      test: schemaGated,
    },
  };
}

/**
 * The best alternative for a task this model cannot do — free first, then any.
 *
 * Returns a model *id from the live catalogue*, never a hardcoded name: the point of the one-click
 * switch is that it offers something that exists and is measured capable today, not a suggestion
 * that was true when the code was written.
 */
export function suggestCapableModel(
  catalogue: readonly CatalogueModel[],
  current: string,
): CatalogueModel | null {
  const capable = catalogue.filter((m) => m.structuredOutput && m.id !== current);
  if (capable.length === 0) return null;
  // Free and code-oriented, then free, then anything capable. Cost before specialisation: a paid
  // suggestion the user did not ask for is a worse default than a free general model.
  return (
    capable.find((m) => m.free && m.codeCapable) ??
    capable.find((m) => m.free) ??
    capable[0] ??
    null
  );
}
