#!/usr/bin/env node
// Posts (or updates) one PR comment summarizing ESLint + tsc results from fixora-pr.yml.
// Reads: eslint-results.json (ESLint JSON formatter output, may be absent), tsc-node.txt,
// tsc-web.txt (raw `tsc --noEmit` output). Writes via the GitHub REST API using GITHUB_TOKEN.

import { readFileSync, existsSync } from 'node:fs';

const MARKER = '<!-- fixora-pr-comment -->';
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const PR_NUMBER = process.env.PR_NUMBER;

if (!TOKEN || !REPO || !PR_NUMBER) {
  console.error('Missing GITHUB_TOKEN, REPO, or PR_NUMBER — skipping comment.');
  process.exit(0);
}

function readJson(path) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// ESLint JSON formatter: one entry per file, each with a `messages` array.
const eslintResults = readJson('eslint-results.json');
const rows = [];
for (const file of eslintResults) {
  for (const msg of file.messages ?? []) {
    rows.push({
      severity: msg.severity === 2 ? '🔴 Error' : '🟡 Warning',
      rule: msg.ruleId ?? 'parse-error',
      file: file.filePath.replace(process.cwd() + '/', ''),
      line: msg.line ?? '?',
    });
  }
}

// `tsc --noEmit` output: lines like `src/foo.ts(12,3): error TS2322: message`.
const TSC_LINE = /^(.+?)\((\d+),\d+\): error (TS\d+): /;
for (const text of [readText('tsc-node.txt'), readText('tsc-web.txt')]) {
  for (const line of text.split('\n')) {
    const match = TSC_LINE.exec(line);
    if (match) {
      rows.push({ severity: '🔴 Error', rule: match[3], file: match[1], line: match[2] });
    }
  }
}

let body;
if (rows.length === 0) {
  body = `${MARKER}\n## 🤖 Fixora Analysis\n\n✅ No issues found!\n\n<sub>Powered by [Fixora](https://fixora-opal.vercel.app)</sub>`;
} else {
  const table = [
    '| Severity | Rule | File | Line |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.severity} | ${r.rule} | ${r.file} | ${r.line} |`),
  ].join('\n');
  body = `${MARKER}\n## 🤖 Fixora Analysis\n\nFound ${String(rows.length)} issue${rows.length === 1 ? '' : 's'} in this PR:\n\n${table}\n\n> Fix instantly with [Fixora](https://fixora-opal.vercel.app)\n\n<sub>Powered by Fixora</sub>`;
}

const api = `https://api.github.com/repos/${REPO}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
};

const existing = await fetch(`${api}/issues/${PR_NUMBER}/comments`, { headers }).then((r) =>
  r.json(),
);
const previous = Array.isArray(existing)
  ? existing.find((c) => typeof c.body === 'string' && c.body.includes(MARKER))
  : undefined;

if (previous) {
  await fetch(`${api}/issues/comments/${String(previous.id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body }),
  });
} else {
  await fetch(`${api}/issues/${PR_NUMBER}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
}
