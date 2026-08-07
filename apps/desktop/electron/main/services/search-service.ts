import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import type { SearchMatch } from '@fixora/shared-types';

import { assertInsideWorkspace } from './fs/path-guard.js';
import { isSecretPath } from './fs/secrets-denylist.js';
import type { OpenWorkspace } from './workspace-service.js';

/**
 * Full-text project search — plain substring, case-insensitive. Not a regex engine: a regex the
 * user types is untrusted input running against every line of every file, and a catastrophic
 * backtracking pattern is exactly the kind of freeze this whole feature exists to avoid (the same
 * reasoning that keeps the ignore matcher on gitignore semantics rather than free-form regex).
 *
 * Sequential, one file at a time — never all files' content in memory together — with a periodic
 * yield and two hard caps (files scanned, matches returned), which is what makes a 100k+ file
 * project a bounded amount of work instead of an unbounded one. Mirrors the chunking pattern
 * `workspace-service.ts`'s `indexFiles` and `analysis-service.ts`'s `collectTargets` already use.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip files too large to be worth scanning
const MAX_FILES_SCANNED = 100_000; // sanity bound, not the common case
const MAX_MATCHES = 300; // enough to page through by eye; more than this is a query to narrow
const MAX_MATCHES_PER_FILE = 20; // one huge generated file must not crowd out every other result
const CONTEXT_LINES = 1;
const YIELD_EVERY = 100;

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** A binary file sniffed by a NUL byte in its first chunk — the same heuristic `file`/git use. */
function looksBinary(content: string): boolean {
  return content.slice(0, 8000).includes(String.fromCharCode(0));
}

export async function searchWorkspace(
  open: OpenWorkspace,
  query: string,
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const needle = query.toLowerCase();
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const walk = async (relDir: string): Promise<void> => {
    if (matches.length >= MAX_MATCHES || filesScanned >= MAX_FILES_SCANNED) return;
    let entries;
    try {
      entries = readdirSync(
        assertInsideWorkspace(join(open.rootPath, relDir), open.rootPath),
        { withFileTypes: true },
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES || filesScanned >= MAX_FILES_SCANNED) {
        truncated = true;
        return;
      }
      const relPath = relDir === '' ? entry.name : posix.join(relDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!open.ignore.ignores(`${relPath}/`)) await walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (open.ignore.ignores(relPath) || isSecretPath(relPath)) continue;

      const absPath = join(open.rootPath, relPath);
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;

      filesScanned += 1;
      if (filesScanned % YIELD_EVERY === 0) await yieldToEventLoop();

      let content: string;
      try {
        content = readFileSync(absPath, 'utf8');
      } catch {
        continue; // unreadable, or not valid utf8 — skip rather than fail the whole search
      }
      if (looksBinary(content)) continue;

      const lines = content.split('\n');
      let perFile = 0;
      for (let i = 0; i < lines.length; i += 1) {
        if (perFile >= MAX_MATCHES_PER_FILE || matches.length >= MAX_MATCHES) break;
        const line = lines[i];
        if (line === undefined) continue;
        const col = line.toLowerCase().indexOf(needle);
        if (col === -1) continue;
        matches.push({
          file: relPath,
          line: i + 1,
          column: col + 1,
          matchLength: query.length,
          lineText: line,
          contextBefore: lines.slice(Math.max(0, i - CONTEXT_LINES), i),
          contextAfter: lines.slice(i + 1, i + 1 + CONTEXT_LINES),
        });
        perFile += 1;
      }
    }
  };

  await walk('');
  if (matches.length >= MAX_MATCHES) truncated = true;
  return { matches, truncated };
}
