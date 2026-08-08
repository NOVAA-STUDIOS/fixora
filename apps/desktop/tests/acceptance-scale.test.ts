import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDatabase } from '../electron/main/db/database.js';
import {
  createFileIndexRepository,
  createWorkspaceRepository,
} from '../electron/main/db/repositories.js';
import { listDirectory } from '../electron/main/services/fs/fs-service.js';
import { createWorkspaceService } from '../electron/main/services/workspace-service.js';

/**
 * M2 acceptance criterion #1: "opens a 10,000-file repo in <2s with no dropped frames."
 *
 * The architecture's answer is **lazy loading** (workspace-store.ts) — opening a repo lists only the
 * root directory; a directory's children are read when it is expanded. So the operation that gates
 * first paint is `open()` (validate + recents + load ignore rules) followed by one `listDirectory('')`,
 * and it must be independent of the repo's total file count. This test builds a real 10,000-file
 * tree and asserts that path stays well under the 2s budget. The full background index (which reads
 * and hashes every file) runs *off* first paint, so it is measured for information, not gated.
 *
 * "No dropped frames" is a renderer property (VirtualList windows the flat node array) and is
 * verified in the running app; this test pins the main-process half of the claim — that opening does
 * not do O(repo) work before the tree can render.
 */

let root: string;
let dbDir: string;
const TOTAL_FILES = 10_000;
const DIRS = 100; // 100 dirs × 100 files = 10,000, plus a realistic bit of nesting

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fixora-scale-'));
  dbDir = mkdtempSync(join(tmpdir(), 'fixora-scale-db-'));
  // A .gitignore so open() exercises real ignore-rule loading (it is itself a real, indexed file).
  writeFileSync(join(root, '.gitignore'), 'dist/\n*.log\n');
  const languages = ['ts', 'tsx', 'js', 'py', 'go', 'md', 'json', 'css'];
  for (let d = 0; d < DIRS; d++) {
    const dirName = `module-${String(d).padStart(3, '0')}`;
    const abs = join(root, dirName, 'src');
    mkdirSync(abs, { recursive: true });
    for (let f = 0; f < TOTAL_FILES / DIRS; f++) {
      const ext = languages[f % languages.length] ?? 'ts';
      const n = String(f);
      writeFileSync(
        join(abs, `file-${n}.${ext}`),
        `// ${dirName} file ${n}\nexport const x = ${n};\n`,
      );
    }
  }
  // A build dir and logs that the .gitignore must exclude — proves ignore rules hold at scale, not
  // just in the unit tests. None of these may appear in the index.
  mkdirSync(join(root, 'dist'), { recursive: true });
  for (let i = 0; i < 200; i++)
    writeFileSync(join(root, 'dist', `bundle-${String(i)}.js`), 'ignored');
  writeFileSync(join(root, 'build.log'), 'ignored');
  // Writing ~10k files can exceed the default 10s hook timeout on a loaded Windows box; give the
  // fixture room so a slow disk is not mistaken for a failure.
}, 60_000);

/**
 * Windows holds the SQLite file handle briefly after close, and removing a 10k-file tree is not
 * instant; retry the temp cleanup generously rather than flake the suite on a still-locked handle.
 * A failure to delete a temp dir is never a product bug, so swallow it if even the retries lose.
 */
function rmWithRetry(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // best-effort temp cleanup — the OS reaps the temp dir eventually
  }
}

afterAll(() => {
  rmWithRetry(root);
  rmWithRetry(dbDir);
});

describe('M2 scale acceptance: a 10,000-file repo', () => {
  it('opens and paints the root in well under 2s (lazy — cost is O(root), not O(repo))', async () => {
    const { driver } = openDatabase({ dir: dbDir });
    const service = createWorkspaceService({
      workspaces: createWorkspaceRepository(driver),
      files: createFileIndexRepository(driver),
    });

    const start = performance.now();
    service.open(root);
    const workspace = service.requireRoot();
    const rootEntries = await listDirectory(workspace.rootPath, '', workspace.ignore);
    const elapsed = performance.now() - start;

    // The root holds the 100 module dirs (dist/ is ignored, so it is not listed even if present).
    expect(rootEntries.length).toBeGreaterThanOrEqual(DIRS);
    expect(elapsed).toBeLessThan(2000);
    // In practice this is single-digit milliseconds; assert an order of magnitude of headroom so a
    // regression that makes open() walk the whole tree (the exact bug lazy loading prevents) fails.
    expect(elapsed).toBeLessThan(500);

    driver.close();
  });

  it('indexes all 10,000 files in the background (off first paint)', async () => {
    const { driver } = openDatabase({ dir: dbDir });
    const files = createFileIndexRepository(driver);
    const service = createWorkspaceService({
      workspaces: createWorkspaceRepository(driver),
      files,
    });
    const { workspace } = service.open(root);
    const open = service.requireRoot();

    const count = await service.indexFiles(open);
    // Every non-ignored file is indexed and persisted; this proves the walk + hash pipeline scales.
    // The +1 is the .gitignore itself (a real file); the 200 dist/ bundles and build.log are excluded
    // by the ignore rules, so a passing count is also proof the ignore filter holds at 10k scale.
    const EXPECTED = TOTAL_FILES + 1;
    expect(count).toBe(EXPECTED);
    expect(files.countForWorkspace(workspace.id)).toBe(EXPECTED);

    driver.close();
    // Reading + SHA-256 hashing 10k files is intentionally heavy; it runs off first paint, so this
    // is not gated by the 2s budget — the generous timeout reflects that it is background work.
    // Raised from 30s: indexFiles now yields to the event loop every 200 files (main-process
    // responsiveness fix) rather than walking in one synchronous call, and 50 real `setImmediate`
    // round-trips add wall-clock time this test's budget has to accommodate.
  }, 60_000);
});
