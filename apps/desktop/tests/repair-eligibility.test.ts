import { describe, expect, it } from 'vitest';

import {
  evaluateRepairEligibility,
  type RepairEligibilityInput,
} from '../electron/main/ai/repair-eligibility.js';

/**
 * P0.1 Part 2 — the Repair Eligibility Engine. Every request yields a decision object with a precise,
 * non-generic reason. These pin every branch, and assert the DoD invariant: no reason is ever generic,
 * and availability depends ONLY on language / rule / model capability (Part 4).
 */
function input(over: Partial<RepairEligibilityInput>): RepairEligibilityInput {
  return {
    language: 'typescript',
    ruleId: 'TS2322',
    repairability: 'ai-required',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5',
    repairCapable: true,
    ...over,
  };
}

const GENERIC = /internal error|unknown error|something went wrong/i;

describe('evaluateRepairEligibility', () => {
  it('an ai-required finding with a capable model is repairable via ai', () => {
    const d = evaluateRepairEligibility(input({}));
    expect(d).toMatchObject({ repairable: true, capability: 'repair', method: 'ai', reason: null });
  });

  it('a safe-auto finding is repairable deterministically — no model needed', () => {
    const d = evaluateRepairEligibility(input({ repairability: 'safe-auto', model: null }));
    expect(d).toMatchObject({
      repairable: true,
      method: 'deterministic',
      capability: null,
      reason: null,
    });
  });

  it('a manual finding is not repairable, and says the fix is the developer’s', () => {
    const d = evaluateRepairEligibility(input({ repairability: 'manual', ruleId: 'TS2304' }));
    expect(d.repairable).toBe(false);
    expect(d.reason).toContain('TS2304');
    expect(d.reason).toMatch(/manual|you can make|unknowable/i);
  });

  it('an unsupported language is not repairable, and names what IS supported', () => {
    const d = evaluateRepairEligibility(input({ language: null }));
    expect(d.repairable).toBe(false);
    expect(d.reason).toMatch(/unsupported file type/i);
    expect(d.reason).toContain('TypeScript');
  });

  it('ai-required with no model selected explains where to choose one', () => {
    const d = evaluateRepairEligibility(input({ model: null }));
    expect(d.repairable).toBe(false);
    expect(d.reason).toMatch(/no model is selected/i);
    expect(d.reason).toContain('Settings');
  });

  it('ai-required with an incapable model surfaces the capability reason verbatim', () => {
    const d = evaluateRepairEligibility(
      input({
        repairCapable: false,
        repairCapabilityReason: 'This model does not accept a JSON schema.',
      }),
    );
    expect(d.repairable).toBe(false);
    expect(d.reason).toBe('This model does not accept a JSON schema.');
  });

  it('ai-required with an incapable model falls back to a specific default reason naming the model', () => {
    const d = evaluateRepairEligibility(input({ repairCapable: false, model: 'openai/gpt-3.5' }));
    expect(d.repairable).toBe(false);
    expect(d.reason).toContain('openai/gpt-3.5');
    expect(d.reason).toMatch(/lacks repair capability/i);
  });

  it('ai-required with UNKNOWN capability refuses rather than guessing, and says so', () => {
    const d = evaluateRepairEligibility(input({ repairCapable: null }));
    expect(d.repairable).toBe(false);
    expect(d.reason).toMatch(/could not be determined|unreachable/i);
    expect(d.reason).toMatch(/disabled rather than/i);
  });

  it('NO branch ever returns a generic message (the DoD invariant)', () => {
    const cases: Partial<RepairEligibilityInput>[] = [
      {},
      { repairability: 'safe-auto' },
      { repairability: 'manual' },
      { language: null },
      { model: null },
      { repairCapable: false },
      { repairCapable: null },
    ];
    for (const c of cases) {
      const d = evaluateRepairEligibility(input(c));
      if (d.reason !== null) expect(d.reason, JSON.stringify(c)).not.toMatch(GENERIC);
    }
  });

  it('the decision never mentions folder, drive, or workspace (Part 4 — availability is intrinsic)', () => {
    // The whole input has no folder/workspace field; this guards that no reason string invents one.
    for (const c of [
      {},
      { repairability: 'manual' as const },
      { language: null },
      { model: null },
    ]) {
      const d = evaluateRepairEligibility(input(c));
      expect(d.reason ?? '').not.toMatch(/folder|drive|onedrive|workspace name|directory/i);
    }
  });
});
