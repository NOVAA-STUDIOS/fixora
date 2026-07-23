import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { languageForPath, type AnalysisFile } from '@fixora/core-analysis';

/**
 * Project discovery for the validation harness.
 *
 * A project is any directory under the corpus (or an external root the caller points at) that carries
 * a `validation.json` manifest. The manifest is intentionally thin: the primary language for roll-up,
 * the external tools the project's analysis needs (so a missing tool SKIPS rather than silently
 * under-reports), and a declarative compile kind. Everything else — which files exist, which language
 * each is — is discovered from the tree, never hand-maintained.
 */

const MANIFEST = 'validation.json';

/** How a project is compiled/type-checked after a repair. Each maps to a real, resolved invocation. */
export type CompileKind = 'node-check' | 'tsc' | 'py-compile' | 'json-parse' | 'none';

export interface ProjectManifest {
  name: string;
  /** Primary language, used only for reporting roll-up; analysis is still per-file. */
  language: string;
  /** External tools the analysis needs; a project whose tools are absent is skipped, not failed. */
  requiresTools: string[];
  compile: CompileKind;
  note?: string;
}

export interface DiscoveredProject {
  dir: string;
  manifest: ProjectManifest;
}

export function discoverProjects(root: string): DiscoveredProject[] {
  const out: DiscoveredProject[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name.startsWith('.')
      )
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== MANIFEST) continue;
      const manifest = JSON.parse(readFileSync(full, 'utf8')) as ProjectManifest;
      out.push({ dir, manifest });
    }
  };
  walk(root);
  return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** The analyzable files of a project — every file the engine has a language for. */
export function collectFiles(root: string): AnalysisFile[] {
  const files: AnalysisFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name.startsWith('.')
      )
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name === MANIFEST) continue;
      const rel = relative(root, full).split(sep).join('/');
      const language = languageForPath(rel);
      if (language === null) continue;
      files.push({ file: rel, absPath: full, language });
    }
  };
  walk(root);
  return files.sort((a, b) => a.file.localeCompare(b.file));
}
