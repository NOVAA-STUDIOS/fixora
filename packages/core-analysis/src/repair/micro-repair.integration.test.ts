import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuffAnalyzer } from '../analyzers/ruff.js';
import { detectCapabilities } from '../capabilities.js';
import { createAnalysisContext } from '../context.js';

import { classifyRepair, deterministicRepair } from './micro-repair.js';

/**
 * The whole deterministic micro-repair chain against a REAL tool, no mocks and no model: analyze a
 * Python file with an unused import, take the safe autofix Ruff authored, apply it, pass the parser
 * gate, and then re-analyze the patched source to prove the finding is actually gone. That last step
 * is the verifier's essence — a repair that does not clear the finding is not a repair — and it is
 * measurable here without a provider key, which is the point.
 *
 * Skips honestly (rather than failing) if the vendored Ruff is not present in this checkout.
 */
describe('deterministic micro-repair — real Ruff, end to end', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('removes an unused import, parses clean, and clears the finding on re-analysis', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-mr-'));
    dirs.push(root);
    writeFileSync(join(root, 'main.py'), 'import os\nimport sys\n\nprint(sys.argv)\n');

    const caps = await detectCapabilities(root);
    if (!caps.tools.has('ruff')) {
      console.warn('[micro-repair] ruff unavailable — deterministic repair path NOT exercised');
      return;
    }

    const files = [
      { file: 'main.py', absPath: join(root, 'main.py'), language: 'python' as const },
    ];
    const analyze = async (): Promise<string[]> => {
      const ctx = createAnalysisContext({ root, capabilities: caps, files });
      const out: string[] = [];
      for await (const f of createRuffAnalyzer().run(ctx, new AbortController().signal)) {
        out.push(f.ruleId);
      }
      return out;
    };

    // 1. Analyze — the unused `import os` must be reported (F401).
    const ctx = createAnalysisContext({ root, capabilities: caps, files });
    const before = [];
    for await (const f of createRuffAnalyzer().run(ctx, new AbortController().signal))
      before.push(f);
    const f401 = before.find((f) => f.ruleId === 'F401');
    expect(f401, 'F401 should be reported for the unused import').toBeDefined();

    // 2. It classifies as a safe deterministic repair and carries the tool's own fix.
    expect(classifyRepair(f401!)).toBe('safe-auto');
    expect(f401!.autofix).toBeDefined();

    // 3. Apply it deterministically and clear the parser gate.
    const source = readFileSync(join(root, 'main.py'), 'utf8');
    const repair = await deterministicRepair({
      finding: f401!,
      source,
      language: 'python',
      filePath: 'main.py',
    });
    expect(repair).not.toBeNull();
    expect(repair!.parseOk, 'patched file must parse').toBe(true);
    expect(repair!.patched).not.toContain('import os');
    expect(repair!.patched).toContain('import sys');

    // 4. The verifier's essence: write the patch and re-analyze — the finding is actually gone, and
    //    no new finding was introduced.
    writeFileSync(join(root, 'main.py'), repair!.patched);
    const after = await analyze();
    expect(after).not.toContain('F401');
    expect(after.length).toBeLessThan(before.length);
  });
});
