import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../electron/main/db/database.js';
import {
  createFindingsRepository,
  createRepairHistoryRepository,
  createWorkspaceRepository,
} from '../electron/main/db/repositories.js';

/**
 * Workspace isolation, proven rather than assumed (P0 attribution sprint).
 *
 * The investigation that prompted these found storage and retrieval to be correctly scoped, and the
 * apparent misattribution to be a *lifecycle* problem: main restored the last workspace at startup
 * regardless of the user's preference, so a query issued before the renderer closed it again
 * answered for the wrong project. These tests pin the half that was already right, so a future
 * change cannot quietly break it while attention is on the half that was not.
 *
 * Every assertion is about a real SQLite database, not a mock — the bug class being guarded against
 * is a missing WHERE clause, which a mocked repository cannot exhibit.
 */
describe('workspace isolation', () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  let workspaces: ReturnType<typeof createWorkspaceRepository>;
  let findings: ReturnType<typeof createFindingsRepository>;
  let history: ReturnType<typeof createRepairHistoryRepository>;

  /** A Finding for `rel` in `ws`. Only `.data` is stored; the wrapper keeps call sites readable. */
  const finding = (ws: string, rel: string, rule: string): { data: Finding } => ({
    data: {
      id: `${ws}:${rel}:${rule}`,
      source: 'tsc',
      ruleId: rule,
      severity: 'error',
      category: 'correctness',
      location: { file: rel, startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
      message: 'm',
      evidence: { snippet: 's', relatedLocations: [], toolOutput: {} },
      fixable: false,
      repair: 'ai-required',
      confidence: 1,
    },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fx-iso-'));
    mkdirSync(dir, { recursive: true });
    db = openDatabase({ dir });
    workspaces = createWorkspaceRepository(db.driver);
    findings = createFindingsRepository(db.driver);
    history = createRepairHistoryRepository(db.driver);
  });

  afterEach(() => {
    db.driver.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never returns another workspace’s findings', () => {
    const a = workspaces.upsertByRootPath('/projects/a', 'a');
    const b = workspaces.upsertByRootPath('/projects/b', 'b');
    findings.replaceForFile(a.id, 'src/a.ts', [finding(a.id, 'src/a.ts', 'TS1000').data]);
    findings.replaceForFile(b.id, 'backend/x.js', [finding(b.id, 'backend/x.js', 'TS2339').data]);
    findings.replaceForFile(b.id, 'frontend/y.ts', [finding(b.id, 'frontend/y.ts', 'TS2339').data]);

    const inA = findings.list(a.id, {});
    expect(inA).toHaveLength(1);
    // The exact shape of the reported symptom: b's paths must never surface under a.
    expect(inA.every((f) => !f.location.file.startsWith('backend/'))).toBe(true);
    expect(findings.list(b.id, {})).toHaveLength(2);
  });

  it('keeps summaries scoped', () => {
    const a = workspaces.upsertByRootPath('/projects/a', 'a');
    const b = workspaces.upsertByRootPath('/projects/b', 'b');
    findings.replaceForFile(a.id, 'a.ts', [finding(a.id, 'a.ts', 'R1').data]);
    findings.replaceForFile(b.id, 'b.ts', [finding(b.id, 'b.ts', 'R2').data]);
    findings.replaceForFile(b.id, 'c.ts', [finding(b.id, 'c.ts', 'R3').data]);
    expect(findings.summary(a.id).total).toBe(1);
    expect(findings.summary(b.id).total).toBe(2);
  });

  it('survives A → B → C → A without leaking', () => {
    const ids = ['a', 'b', 'c'].map((n) => workspaces.upsertByRootPath(`/projects/${n}`, n));
    for (const [i, w] of ids.entries()) {
      findings.replaceForFile(w.id, `${w.name}/file.ts`, [
        finding(w.id, `${w.name}/file.ts`, `RULE${String(i)}`).data,
      ]);
    }
    // Return to A and re-analyze: its own results replace, and nobody else's move.
    findings.replaceForFile(ids[0]!.id, 'a/file.ts', []);
    findings.replaceForFile(ids[0]!.id, 'a/again.ts', [
      finding(ids[0]!.id, 'a/again.ts', 'RULE0').data,
    ]);

    for (const w of ids) {
      const rows = findings.list(w.id, {});
      expect(
        rows.every((f) => f.location.file.startsWith(`${w.name}/`)),
        w.name,
      ).toBe(true);
    }
    expect(findings.list(ids[0]!.id, {})).toHaveLength(1);
  });

  it('re-analyzing one workspace does not clear another', () => {
    const a = workspaces.upsertByRootPath('/projects/a', 'a');
    const b = workspaces.upsertByRootPath('/projects/b', 'b');
    findings.replaceForFile(a.id, 'a.ts', [finding(a.id, 'a.ts', 'R1').data]);
    findings.replaceForFile(b.id, 'b.ts', [finding(b.id, 'b.ts', 'R2').data]);
    findings.replaceForFile(a.id, 'a.ts', []); // a re-analyzed clean
    expect(findings.list(a.id, {})).toHaveLength(0);
    expect(findings.list(b.id, {})).toHaveLength(1);
  });

  it('keeps repair history scoped, and clearing one leaves the other', () => {
    const a = workspaces.upsertByRootPath('/projects/a', 'a');
    const b = workspaces.upsertByRootPath('/projects/b', 'b');
    const repair = (ws: string, rel: string) => ({
      workspaceId: ws,
      findingId: `${ws}-f`,
      relPath: rel,
      symbolName: null,
      ruleId: 'R',
      source: 'tsc' as const,
      verdict: 'verified' as const,
      rationale: 'r',
      originalCode: 'a',
      repairedCode: 'b',
      model: 'm',
      confidence: 1,
      startLine: 1,
      endLine: 1,
    });
    history.record(repair(a.id, 'a.ts'));
    history.record(repair(b.id, 'b.ts'));
    expect(history.list(a.id)).toHaveLength(1);
    expect(history.list(b.id)).toHaveLength(1);

    history.clearWorkspace(a.id);
    expect(history.list(a.id)).toHaveLength(0);
    expect(history.list(b.id), 'clearing a must not touch b').toHaveLength(1);
  });

  it('forgetting a workspace does not delete another workspace’s rows', () => {
    const a = workspaces.upsertByRootPath('/projects/a', 'a');
    const b = workspaces.upsertByRootPath('/projects/b', 'b');
    findings.replaceForFile(b.id, 'b.ts', [finding(b.id, 'b.ts', 'R2').data]);
    workspaces.remove(a.id);
    expect(workspaces.recent().map((w) => w.id)).toEqual([b.id]);
    expect(findings.list(b.id, {})).toHaveLength(1);
  });

  it('a reopened workspace keeps its identity, so its findings stay attached', () => {
    const first = workspaces.upsertByRootPath('/projects/a', 'a');
    findings.replaceForFile(first.id, 'a.ts', [finding(first.id, 'a.ts', 'R1').data]);
    const again = workspaces.upsertByRootPath('/projects/a', 'a');
    expect(again.id).toBe(first.id);
    expect(findings.list(again.id, {})).toHaveLength(1);
  });
});
