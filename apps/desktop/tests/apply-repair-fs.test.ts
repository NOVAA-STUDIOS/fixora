import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ApplyOutcome } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

type ApplyReq = {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  expectedOriginal: string;
  historyId?: string;
};
type Handler = (req: ApplyReq, ctx: { requestId: string; window: null }) => ApplyOutcome;

/**
 * P0 Priority 1 regression: `ai:applyRepair` reads then writes the real file, and BOTH are guarded.
 * A file deleted/renamed/locked between repair and apply is an expected, actionable condition — it
 * must come back as an ApplyOutcome carrying the fs layer's precise reason, never thrown into the
 * router where it would become "Something went wrong handling that action." These drive the REAL
 * handler against a REAL temp workspace (no Electron, no provider), so the guard is proven end to end.
 */
async function applyHandler(root: string): Promise<Handler> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');
  registerAiHandlers({
    keyStore: {} as never,
    aiService: { run: vi.fn(), cancel: vi.fn() } as never,
    workspace: { getCurrent: () => ({ id: 'ws', rootPath: root, name: 'p', ignore: [] }) } as never,
    history: { markApplied: vi.fn(), record: vi.fn(), list: () => [], remove: vi.fn() } as never,
    catalogue: {} as never,
  });
  return getHandler('ai:applyRepair') as unknown as Handler;
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fx-apply-'));
  mkdirSync(join(root, 'src'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ai:applyRepair — filesystem failures travel as contract data', () => {
  it('a repair targeting a file that no longer exists returns read-failed, not a thrown error', async () => {
    const handler = await applyHandler(root);
    // src/gone.ts was never created — the read must fail with the fs layer's precise reason.
    const outcome = handler(
      { file: 'src/gone.ts', startLine: 1, endLine: 1, code: 'x', expectedOriginal: 'x' },
      { requestId: 'r1', window: null },
    );
    expect(outcome.applied).toBe(false);
    if (!outcome.applied) {
      expect(outcome.reason).toBe('read-failed');
      expect(outcome.message).toContain('no longer exists');
      expect(outcome.message.toLowerCase()).not.toContain('something went wrong');
      expect(outcome.message.toLowerCase()).not.toContain('internal error');
    }
  });

  it('applies cleanly when the file is present and the range matches', async () => {
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1;\n');
    const handler = await applyHandler(root);
    const outcome = handler(
      {
        file: 'src/a.ts',
        startLine: 1,
        endLine: 1,
        code: 'const a = 2;',
        expectedOriginal: 'const a = 1;',
      },
      { requestId: 'r2', window: null },
    );
    expect(outcome.applied).toBe(true);
  });

  it('P0.2 runtime proof: applying to a CRLF file leaves it uniformly CRLF, not mixed', () => {
    // Windows file with CRLF endings; the "repair" is LF, as a model reply always is.
    const crlf = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n';
    writeFileSync(join(root, 'src', 'w.ts'), crlf);
    return applyHandler(root).then((handler) => {
      const outcome = handler(
        {
          file: 'src/w.ts',
          startLine: 2,
          endLine: 2,
          code: 'const b = 20;', // LF (no \r), like every model reply
          expectedOriginal: 'const b = 2;', // stale check compares stripped content — matches
        },
        { requestId: 'rc', window: null },
      );
      expect(outcome.applied).toBe(true);
      const after = readFileSync(join(root, 'src', 'w.ts'), 'utf8');
      expect(after).toBe('const a = 1;\r\nconst b = 20;\r\nconst c = 3;\r\n');
      expect(/(?<!\r)\n/.test(after)).toBe(false); // no lone LF survived — no mixed endings
    });
  });

  it('P0.3 multi-error safety: a second repair computed against the pre-change file is refused, never misapplied (req #4)', async () => {
    // Two findings in one file. Repair A changes line 2; repair B was computed against the ORIGINAL
    // file (its expectedOriginal is the pre-A text). After A applies, B must be refused as stale —
    // applying it would splice B's edit over content that is no longer what B was built against.
    writeFileSync(join(root, 'src', 'm.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const handler = await applyHandler(root);

    const a = handler(
      {
        file: 'src/m.ts',
        startLine: 2,
        endLine: 2,
        code: 'const b = 20;',
        expectedOriginal: 'const b = 2;',
      },
      { requestId: 'A', window: null },
    );
    expect(a.applied).toBe(true);

    // Repair B targets the same line but its expectedOriginal is the ORIGINAL (stale) text.
    const b = handler(
      {
        file: 'src/m.ts',
        startLine: 2,
        endLine: 2,
        code: 'const b = 99;',
        expectedOriginal: 'const b = 2;',
      },
      { requestId: 'B', window: null },
    );
    expect(b.applied).toBe(false);
    if (!b.applied) expect(b.reason).toBe('stale-range');
    // The file still holds A's change — B did not overwrite it.
    expect(readFileSync(join(root, 'src', 'm.ts'), 'utf8')).toBe(
      'const a = 1;\nconst b = 20;\nconst c = 3;\n',
    );
  });

  it('P0.3 req #7: a repair whose expected original no longer matches is never applied', async () => {
    writeFileSync(join(root, 'src', 'x.ts'), 'const a = 1;\n');
    const handler = await applyHandler(root);
    const outcome = handler(
      {
        file: 'src/x.ts',
        startLine: 1,
        endLine: 1,
        code: 'const a = 2;',
        expectedOriginal: 'const a = OLD;',
      },
      { requestId: 'x', window: null },
    );
    expect(outcome.applied).toBe(false);
    if (!outcome.applied) expect(outcome.reason).toBe('stale-range');
    expect(readFileSync(join(root, 'src', 'x.ts'), 'utf8')).toBe('const a = 1;\n'); // untouched
  });

  it('a read-only file returns write-failed with an authored reason (or applies) — never a raw throw', () => {
    // POSIX-as-root and some Windows setups will simply allow the write; what must never happen is an
    // unhandled throw. So this asserts the shape of the refusal WHEN it refuses, and never crashes.
    return (async () => {
      const file = join(root, 'src', 'ro.ts');
      writeFileSync(file, 'const a = 1;\n');
      chmodSync(file, 0o444);
      const handler = await applyHandler(root);
      let outcome: ApplyOutcome;
      try {
        outcome = handler(
          {
            file: 'src/ro.ts',
            startLine: 1,
            endLine: 1,
            code: 'const a = 2;',
            expectedOriginal: 'const a = 1;',
          },
          { requestId: 'r3', window: null },
        );
      } finally {
        chmodSync(file, 0o644);
      }
      if (!outcome.applied) {
        expect(outcome.reason).toBe('write-failed');
        expect(outcome.message.toLowerCase()).not.toContain('something went wrong');
      }
    })();
  });
});

/**
 * Apply reliability: a small, unrelated edit above the target must not force a re-run. The target
 * text itself is unchanged, so relocating to it and splicing carries no more risk than applying at
 * the original (unmoved) line range — the bytes written are still exactly what was verified.
 */
describe('ai:applyRepair — survives a target that moved but did not change', () => {
  it('relocates when a line was inserted above the target and applies exactly', async () => {
    writeFileSync(
      join(root, 'src', 'm.ts'),
      // A new import was added above the target after the repair was generated — the target
      // (`const b = 2;`) shifted from line 2 to line 3, unchanged.
      'import { x } from "./x";\nconst a = 1;\nconst b = 2;\nconst c = 3;\n',
    );
    const handler = await applyHandler(root);
    const outcome = handler(
      {
        file: 'src/m.ts',
        startLine: 2, // stale — recorded before the import was added
        endLine: 2,
        code: 'const b = 20;',
        expectedOriginal: 'const b = 2;',
      },
      { requestId: 'r1', window: null },
    );
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.relocated).toBe(true);
    expect(readFileSync(join(root, 'src', 'm.ts'), 'utf8')).toBe(
      'import { x } from "./x";\nconst a = 1;\nconst b = 20;\nconst c = 3;\n',
    );
  });

  it('does NOT relocate when the target text itself changed — still refuses as stale-range', async () => {
    writeFileSync(
      join(root, 'src', 'm.ts'),
      // The target line changed (not just moved) — no exact match exists anywhere, so this must
      // still refuse rather than guess at a "close enough" location.
      'import { x } from "./x";\nconst a = 1;\nconst b = 999;\nconst c = 3;\n',
    );
    const handler = await applyHandler(root);
    const outcome = handler(
      {
        file: 'src/m.ts',
        startLine: 2,
        endLine: 2,
        code: 'const b = 20;',
        expectedOriginal: 'const b = 2;',
      },
      { requestId: 'r2', window: null },
    );
    expect(outcome.applied).toBe(false);
    if (!outcome.applied) expect(outcome.reason).toBe('stale-range');
    expect(readFileSync(join(root, 'src', 'm.ts'), 'utf8')).toBe(
      'import { x } from "./x";\nconst a = 1;\nconst b = 999;\nconst c = 3;\n',
    );
  });

  it('an unmoved target applies normally with relocated: false', async () => {
    writeFileSync(join(root, 'src', 'm.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    const handler = await applyHandler(root);
    const outcome = handler(
      {
        file: 'src/m.ts',
        startLine: 2,
        endLine: 2,
        code: 'const b = 20;',
        expectedOriginal: 'const b = 2;',
      },
      { requestId: 'r3', window: null },
    );
    expect(outcome.applied).toBe(true);
    if (outcome.applied) expect(outcome.relocated).toBe(false);
  });
});
