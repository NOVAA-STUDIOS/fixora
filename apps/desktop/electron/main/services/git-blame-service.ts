import { execFile } from 'node:child_process';

export type BlameLine = {
  line: number;
  author: string;
  /** Unix seconds — the renderer formats it (locale/relative-time is a display concern). */
  authorTimeUnix: number;
  summary: string;
};

const BLAME_TIMEOUT_MS = 10_000;

/**
 * `git blame --line-porcelain`, parsed into one record per final line number. Never throws: no
 * git binary, not a repository, an untracked/new file, or a workspace with no commits are all
 * ordinary states for a project to be in, not errors — they just mean there is no blame to show,
 * same as `resolveFormatter` returning `null` for a language with no formatter. The renderer
 * degrades to showing nothing rather than an error banner over a feature that is inherently
 * best-effort.
 */
export async function gitBlame(root: string, relPath: string): Promise<BlameLine[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['blame', '--line-porcelain', '--', relPath],
      { cwd: root, timeout: BLAME_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(parsePorcelain(stdout));
      },
    );
  });
}

function parsePorcelain(output: string): BlameLine[] {
  const results: BlameLine[] = [];
  let finalLine = 0;
  let author = '';
  let authorTimeUnix = 0;
  let summary = '';

  for (const raw of output.split('\n')) {
    if (raw.startsWith('\t')) {
      // The content line — end of this record. Only emitted once the header fields for THIS
      // commit have been seen; a line blamed to a commit already reported earlier in the output
      // (porcelain omits repeating unchanged author/summary fields) still carries its own header
      // line (the `<sha> <orig> <final>` line) even when the rest is abbreviated, so finalLine is
      // always current by the time we get here.
      if (finalLine > 0) results.push({ line: finalLine, author, authorTimeUnix, summary });
      continue;
    }
    const headerMatch = /^[0-9a-f]{40} \d+ (\d+)/.exec(raw);
    if (headerMatch?.[1] !== undefined) {
      finalLine = Number(headerMatch[1]);
      continue;
    }
    if (raw.startsWith('author ')) author = raw.slice('author '.length);
    else if (raw.startsWith('author-time ')) authorTimeUnix = Number(raw.slice('author-time '.length)) || 0;
    else if (raw.startsWith('summary ')) summary = raw.slice('summary '.length);
  }
  return results;
}
