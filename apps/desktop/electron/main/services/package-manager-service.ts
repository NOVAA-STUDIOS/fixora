import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ManifestKind, PackageDependency, PackageSearchResult } from '@fixora/shared-types';

import type { OpenWorkspace } from './workspace-service.js';

/**
 * Package Manager tab: read-only main-process work only. Listing parses whichever manifest the
 * workspace root has; searching hits the public registry. Neither installs anything — that runs
 * as an ordinary command in the real Terminal tab (see packages-panel.tsx), which is what makes
 * "handles errors gracefully" free: a failed `npm install` is just a shell showing a nonzero exit,
 * not an outcome this service has to interpret.
 */

export function detectManifestKind(open: OpenWorkspace): ManifestKind {
  if (existsFile(join(open.rootPath, 'package.json'))) return 'npm';
  if (existsFile(join(open.rootPath, 'requirements.txt'))) return 'pip';
  return 'none';
}

function existsFile(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export function listDependencies(open: OpenWorkspace, kind: ManifestKind): PackageDependency[] {
  if (kind === 'npm') return listNpmDependencies(open.rootPath);
  if (kind === 'pip') return listPipDependencies(open.rootPath);
  return [];
}

function listNpmDependencies(rootPath: string): PackageDependency[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  if (typeof manifest !== 'object' || manifest === null) return [];
  const m = manifest as Record<string, unknown>;
  const deps: PackageDependency[] = [];
  for (const [key, dev] of [
    ['dependencies', false],
    ['devDependencies', true],
  ] as const) {
    const section = m[key];
    if (typeof section !== 'object' || section === null) continue;
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === 'string') deps.push({ name, version, dev });
    }
  }
  return deps;
}

/** `name==version`, `name>=version`, or bare `name` — the common `requirements.txt` shapes. Lines
 * that are comments, blank, or an option (`-r other.txt`, `--index-url …`) are not dependencies. */
function listPipDependencies(rootPath: string): PackageDependency[] {
  let text: string;
  try {
    text = readFileSync(join(rootPath, 'requirements.txt'), 'utf8');
  } catch {
    return [];
  }
  const deps: PackageDependency[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (line === '' || line.startsWith('-')) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*(==|>=|<=|~=|!=|>|<)?\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, name, , version] = match;
    if (name === undefined) continue;
    deps.push({ name, version: version === '' ? '*' : (version ?? '*'), dev: false });
  }
  return deps;
}

const SEARCH_TIMEOUT_MS = 8_000;

export async function searchRegistry(
  kind: ManifestKind,
  query: string,
): Promise<PackageSearchResult[]> {
  if (kind === 'npm') return searchNpm(query);
  if (kind === 'pip') return searchPyPi(query);
  return [];
}

async function searchNpm(query: string): Promise<PackageSearchResult[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`;
  const body = (await fetchJson(url)) as {
    objects?: { package?: { name?: string; version?: string; description?: string } }[];
  } | null;
  if (body === null) return [];
  const objects = Array.isArray(body.objects) ? body.objects : [];
  return objects
    .map((o) => o.package)
    .filter((p): p is { name: string; version: string; description?: string } => {
      return typeof p?.name === 'string' && typeof p.version === 'string';
    })
    .map((p) => ({ name: p.name, version: p.version, description: p.description ?? '' }));
}

/** PyPI has no public full-text search API (the HTML search endpoint is not JSON) — this resolves
 * an exact package name via the JSON API, which covers "install the package I already know the
 * name of", the common case, at the cost of not offering fuzzy suggestions. */
async function searchPyPi(query: string): Promise<PackageSearchResult[]> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(query)}/json`;
  const body = (await fetchJson(url)) as {
    info?: { name?: string; version?: string; summary?: string };
  } | null;
  const info = body?.info;
  if (typeof info?.name !== 'string' || typeof info.version !== 'string') return [];
  return [{ name: info.name, version: info.version, description: info.summary ?? '' }];
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline, timed out, or a malformed response — search degrades to "no results"
  } finally {
    clearTimeout(timer);
  }
}
