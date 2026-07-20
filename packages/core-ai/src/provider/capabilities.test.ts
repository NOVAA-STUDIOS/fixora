import { describe, expect, it } from 'vitest';

import { capabilitiesFor, suggestCapableModel } from './capabilities.js';
import type { CatalogueModel } from './catalogue.js';

/**
 * Capability gating, from provider metadata only.
 *
 * The bug: Fixora asserted `structuredOutput: true` on the PROVIDER and applied it to all 338
 * models behind it, 74 of which cannot do it. A user on an incapable model discovered that by
 * pressing Repair and watching it fail, with no way to learn why.
 */
const model = (over: Partial<CatalogueModel> = {}): CatalogueModel => ({
  id: 'x/y:free',
  name: 'Y',
  free: true,
  codeCapable: false,
  structuredOutput: true,
  contextLength: 128000,
  ...over,
});

describe('capabilitiesFor', () => {
  it('gates repair and test on structured output', () => {
    const yes = capabilitiesFor(model({ structuredOutput: true }));
    expect(yes.profiles.repair.supported).toBe(true);
    expect(yes.profiles.test.supported).toBe(true);

    const no = capabilitiesFor(model({ structuredOutput: false }));
    expect(no.profiles.repair.supported).toBe(false);
    expect(no.profiles.test.supported).toBe(false);
    expect(no.profiles.repair.reason).toContain('JSON schema');
  });

  it('leaves explain available on a model without structured output', () => {
    // Explain needs free text only. Disabling it too would remove a working feature to punish a
    // missing capability it never used.
    expect(capabilitiesFor(model({ structuredOutput: false })).profiles.explain.supported).toBe(
      true,
    );
  });

  it('keeps analyze available regardless — it never reaches a model', () => {
    expect(capabilitiesFor(model({ structuredOutput: false })).profiles.analyze.supported).toBe(
      true,
    );
    expect(capabilitiesFor(null).profiles.analyze.supported).toBe(true);
  });

  it('reports UNKNOWN capability as unsupported, never as capable', () => {
    // Fail closed. Optimistically enabling Repair when the catalogue is unreachable reproduces the
    // exact failure being fixed: a button that looks available and is not.
    const none = capabilitiesFor(null);
    expect(none.profiles.repair.supported).toBe(false);
    expect(none.structuredOutput).toBe(false);
  });

  it('records the provider fact each decision was read from', () => {
    // Never hardcoded to a model name — the basis names the metadata field.
    expect(capabilitiesFor(model()).profiles.repair.basis).toContain('structured_outputs');
  });
});

describe('suggestCapableModel', () => {
  it('offers a capable alternative, preferring free and code-oriented', () => {
    const chosen = suggestCapableModel(
      [
        model({ id: 'a/incapable:free', structuredOutput: false }),
        model({ id: 'b/paid', free: false }),
        model({ id: 'c/free-general' }),
        model({ id: 'd/free-code', codeCapable: true }),
      ],
      'a/incapable:free',
    );
    expect(chosen?.id).toBe('d/free-code');
  });

  it('never suggests the model already selected', () => {
    expect(suggestCapableModel([model({ id: 'same' })], 'same')).toBeNull();
  });

  it('returns null when nothing capable exists, rather than a false promise', () => {
    expect(
      suggestCapableModel([model({ id: 'a', structuredOutput: false })], 'current'),
    ).toBeNull();
  });
});
