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

  it('a config diagnosis wins over an ai-required repairability — never reaches the model', () => {
    const d = evaluateRepairEligibility(
      input({
        repairability: 'ai-required',
        ruleId: 'TS2591',
        configDiagnosis: {
          reason: "Node.js's built-in globals aren't typed without @types/node.",
          fix: 'npm install --save-dev @types/node',
        },
      }),
    );
    expect(d.repairable).toBe(false);
    expect(d.method).toBeNull();
    expect(d.capability).toBeNull();
    expect(d.reason).toMatch(/project configuration issue/i);
    expect(d.reason).toContain('npm install --save-dev @types/node');
  });

  it('a config diagnosis wins even when repairCapable/model are already satisfied', () => {
    const d = evaluateRepairEligibility(
      input({
        repairability: 'ai-required',
        configDiagnosis: { reason: 'Missing dependency.', fix: 'npm install left-pad' },
      }),
    );
    expect(d.repairable).toBe(false);
    expect(d.reason).toContain('npm install left-pad');
  });

  it('absent or null configDiagnosis changes nothing — the existing behaviour is untouched', () => {
    expect(evaluateRepairEligibility(input({ configDiagnosis: null }))).toMatchObject({
      repairable: true,
      method: 'ai',
    });
    expect(evaluateRepairEligibility(input({}))).toMatchObject({ repairable: true, method: 'ai' });
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

  it('every language the Analyzer analyzes is repairable — no analyzable-but-unrepairable gap', () => {
    // The gap this closes: a language could be analyzed (producing findings the user can see) while
    // being refused by Repair, so the panel offered a fix for something the engine would not touch.
    // CSS/HTML were exactly that until they were added here; JSON was too, via a stale extension map.
    for (const language of [
      'typescript',
      'javascript',
      'python',
      'go',
      'json',
      'css',
      'html',
    ] as const) {
      const d = evaluateRepairEligibility(input({ language }));
      expect(d, `${language} must be repairable`).toMatchObject({
        repairable: true,
        method: 'ai',
        reason: null,
      });
    }
  });

  it('a CSS missing-semicolon autofix is repairable deterministically, with no model at all', () => {
    // The highest-confidence repair the engine can offer: a one-character edit at a known offset,
    // classified `safe-auto`, so it never reaches a provider.
    const d = evaluateRepairEligibility(
      input({
        language: 'css',
        ruleId: 'css-missing-semicolon',
        repairability: 'safe-auto',
        model: null,
      }),
    );
    expect(d).toMatchObject({ repairable: true, method: 'deterministic', reason: null });
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
