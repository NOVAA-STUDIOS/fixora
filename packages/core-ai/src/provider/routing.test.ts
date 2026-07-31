import { describe, expect, it } from 'vitest';

import type { CatalogueModel } from './catalogue.js';
import { estimateComplexity, rankModelsForTask, selectBestModel } from './routing.js';

function model(over: Partial<CatalogueModel> & { id: string }): CatalogueModel {
  return {
    name: over.id,
    free: true,
    codeCapable: false,
    structuredOutput: true,
    contextLength: 32_000,
    ...over,
  };
}

describe('estimateComplexity', () => {
  it('a tiny CSS fix is low complexity', () => {
    expect(estimateComplexity({ language: 'css', contentChars: 200, findingCount: 1 })).toBe('low');
  });

  it('TypeScript is at least medium even when small — the type system adds weight', () => {
    expect(estimateComplexity({ language: 'typescript', contentChars: 200, findingCount: 1 })).toBe(
      'medium',
    );
  });

  it('multiple coordinated findings is always high, regardless of size', () => {
    expect(estimateComplexity({ language: 'css', contentChars: 50, findingCount: 3 })).toBe('high');
  });

  it('a large file is high complexity even in a simple language', () => {
    expect(estimateComplexity({ language: 'json', contentChars: 30_000, findingCount: 1 })).toBe(
      'high',
    );
  });
});

describe('rankModelsForTask — filtering never guesses past a capability', () => {
  it('excludes a model with no structured output, never merely ranks it low', () => {
    const models = [
      model({ id: 'no-schema', structuredOutput: false }),
      model({ id: 'has-schema' }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'low', estimatedTokens: 100 });
    expect(ranked.map((m) => m.id)).toEqual(['has-schema']);
  });

  it('excludes a model whose context window cannot fit the request', () => {
    const models = [
      model({ id: 'small-ctx', contextLength: 4_000 }),
      model({ id: 'big-ctx', contextLength: 200_000 }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'high', estimatedTokens: 50_000 });
    expect(ranked.map((m) => m.id)).toEqual(['big-ctx']);
  });

  it('a null contextLength is treated as unusably small, not as unlimited', () => {
    const models = [model({ id: 'unknown-ctx', contextLength: null })];
    expect(rankModelsForTask(models, { complexity: 'low', estimatedTokens: 10 })).toEqual([]);
  });
});

describe('rankModelsForTask — high complexity prefers reasoning and headroom', () => {
  it('a reasoning-named model ranks above an equivalent non-reasoning one', () => {
    const models = [
      model({ id: 'plain-model', contextLength: 200_000, codeCapable: true }),
      model({ id: 'deep-reasoning-r1', name: 'Deep Reasoning R1', contextLength: 200_000, codeCapable: true }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'high', estimatedTokens: 10_000 });
    expect(ranked[0]?.id).toBe('deep-reasoning-r1');
  });

  it('more context headroom ranks higher for a high-complexity task', () => {
    const models = [
      model({ id: 'tight', contextLength: 12_000 }),
      model({ id: 'roomy', contextLength: 400_000 }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'high', estimatedTokens: 10_000 });
    expect(ranked[0]?.id).toBe('roomy');
  });
});

describe('rankModelsForTask — low complexity prefers the cheap, sufficient model', () => {
  it('does not reward oversized context for a simple task', () => {
    const models = [
      model({ id: 'right-sized', free: true, contextLength: 16_000 }),
      model({ id: 'oversized', free: true, contextLength: 1_000_000 }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'low', estimatedTokens: 200 });
    expect(ranked[0]?.id).toBe('right-sized');
  });

  it('a free model ranks above an equivalent paid one', () => {
    const models = [
      model({ id: 'paid', free: false, contextLength: 16_000 }),
      model({ id: 'free', free: true, contextLength: 16_000 }),
    ];
    const ranked = rankModelsForTask(models, { complexity: 'low', estimatedTokens: 200 });
    expect(ranked[0]?.id).toBe('free');
  });
});

describe('verification history is a tiebreak, never a capability override', () => {
  it('breaks a tie between two otherwise-equal models', () => {
    const models = [
      model({ id: 'unreliable', contextLength: 32_000 }),
      model({ id: 'reliable', contextLength: 32_000 }),
    ];
    const history = (id: string): number | null =>
      id === 'reliable' ? 0.95 : id === 'unreliable' ? 0.2 : null;
    const ranked = rankModelsForTask(models, { complexity: 'medium', estimatedTokens: 500 }, history);
    expect(ranked[0]?.id).toBe('reliable');
  });

  it('never resurrects a model that failed the capability filter', () => {
    const models = [model({ id: 'incapable', structuredOutput: false })];
    const history = (): number => 1; // perfect history cannot rescue a hard incapability
    const ranked = rankModelsForTask(
      models,
      { complexity: 'low', estimatedTokens: 10 },
      history,
    );
    expect(ranked).toEqual([]);
  });
});

describe('selectBestModel', () => {
  it('returns null rather than a bad guess when nothing qualifies', () => {
    expect(
      selectBestModel([model({ id: 'x', structuredOutput: false })], {
        complexity: 'low',
        estimatedTokens: 10,
      }),
    ).toBeNull();
  });

  it('returns the top-ranked model', () => {
    const models = [model({ id: 'a', contextLength: 1_000 }), model({ id: 'b', contextLength: 500_000 })];
    const best = selectBestModel(models, { complexity: 'high', estimatedTokens: 10_000 });
    expect(best?.id).toBe('b');
  });
});
