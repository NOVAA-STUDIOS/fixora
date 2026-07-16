// The analysis utility process (ADR-017). It runs the deterministic engine in an OS-isolated
// process so a runaway tree-sitter parse, a backtracking Semgrep rule, or a slow type-check can be
// timed out and killed without freezing the editor. It is intentionally thin: main owns the
// workspace root and vets which files may be read (path guard + secrets denylist), then hands this
// worker a list of targets; the worker reads each vetted file, runs `analyzeFile`, and streams the
// findings back. It never touches a path main did not authorise.
//
// ESM on purpose: the engine (`@fixora/core-analysis`) is ESM and loads tree-sitter WASM via
// `import.meta.url`, which only works when it is imported as a real module, not bundled into CJS.
import { readFileSync } from 'node:fs';

import { analyzeFile, createMemoryCache, defaultAnalyzers } from '@fixora/core-analysis';

const port = process.parentPort;
const analyzers = defaultAnalyzers();
const cache = createMemoryCache();
/** jobId -> AbortController, so a cancel message stops the matching run. */
const jobs = new Map();

port.on('message', (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    jobs.get(message.jobId)?.abort();
    return;
  }
  if (message.type === 'analyze') {
    void runJob(message);
  }
});

async function runJob(message) {
  const { jobId, workspaceRoot, capabilities, targets } = message;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  const caps = {
    root: workspaceRoot,
    tools: new Set(capabilities.tools),
    versions: new Map(capabilities.versions),
  };

  try {
    for (const t of targets) {
      if (controller.signal.aborted) break;
      let source;
      try {
        source = readFileSync(t.absPath, 'utf8');
      } catch {
        continue; // file vanished or is unreadable — skip, do not fail the whole job
      }
      const target = {
        file: t.file,
        absPath: t.absPath,
        language: t.language,
        source,
        workspaceRoot,
      };
      const findings = [];
      try {
        for await (const finding of analyzeFile({ target, capabilities: caps, analyzers, cache }, controller.signal)) {
          findings.push(finding);
        }
      } catch {
        continue; // one file's analysis blowing up must not take down the batch
      }
      port.postMessage({ type: 'fileFindings', jobId, file: t.file, findings });
    }
    port.postMessage({ type: 'done', jobId, aborted: controller.signal.aborted });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  } finally {
    jobs.delete(jobId);
  }
}
