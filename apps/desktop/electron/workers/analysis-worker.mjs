// The analysis utility process (ADR-017). It runs the deterministic engine in an OS-isolated
// process so a runaway parse, a backtracking Semgrep rule, or a slow type-check can be timed out and
// killed without freezing the editor. It is intentionally thin: main owns the workspace root and vets
// which files may be read (path guard + secrets denylist + ignore); the worker derives each file's
// language, detects the workspace's tools, runs every analyzer ONCE over the whole set, and streams
// the findings back grouped by file.
//
// ESM on purpose: the engine (`@fixora/core-analysis`) is ESM and loads tree-sitter WASM via
// `import.meta.url`, which only works when it is imported as a real module, not bundled into CJS.
import { readFileSync } from 'node:fs';

import {
  analyzeWorkspace,
  createAnalysisContext,
  detectCapabilities,
  languageForPath,
  parse,
} from '@fixora/core-analysis';

const port = process.parentPort;
/** jobId -> AbortController, so a cancel message stops the matching run. */
const jobs = new Map();
/** workspaceRoot -> detected capabilities; detection spawns `tool --version` probes. */
const capabilitiesByRoot = new Map();

async function capabilitiesFor(root) {
  const cached = capabilitiesByRoot.get(root);
  if (cached !== undefined) return cached;
  const detected = await detectCapabilities(root);
  capabilitiesByRoot.set(root, detected);
  return detected;
}

port.on('message', (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    jobs.get(message.jobId)?.abort();
    return;
  }
  if (message.type === 'analyze') {
    void runJob(message);
    return;
  }
  if (message.type === 'verify') {
    void runVerify(message);
  }
});

/**
 * Verify a repair (ADR-003). The overlay root already has the patched file on disk; we (1) parse it to
 * confirm the fix did not break syntax, then (2) re-run the analyzers on that one file. Main compares
 * the resulting findings against the original to decide verified / regression / unresolved. Tiered and
 * honest: this is static analysis + syntax; tests are a later, opt-in tier.
 */
async function runVerify(message) {
  const { jobId, workspaceRoot, target } = message;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  try {
    let syntaxOk = true;
    try {
      const source = readFileSync(target.absPath, 'utf8');
      // Pass the path so a .tsx target is parsed with the JSX-aware grammar. Without it, a valid
      // React repair parses as plain TypeScript, every JSX tag is a syntax error, and the verdict
      // wrongly becomes "does not parse" — the bug that disabled Apply for every .tsx repair.
      const tree = await parse(target.language, source, target.file);
      syntaxOk = !tree.root.hasError;
      tree.dispose();
    } catch {
      syntaxOk = false;
    }

    const capabilities = await capabilitiesFor(workspaceRoot);
    const context = createAnalysisContext({ root: workspaceRoot, capabilities, files: [target] });
    const findings = [];
    for await (const finding of analyzeWorkspace({ context }, controller.signal)) {
      findings.push(finding);
    }

    port.postMessage({
      type: 'verifyResult',
      jobId,
      syntaxOk,
      findings,
      aborted: controller.signal.aborted,
    });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  } finally {
    jobs.delete(jobId);
  }
}

async function runJob(message) {
  const { jobId, workspaceRoot, targets } = message;
  const controller = new AbortController();
  jobs.set(jobId, controller);

  try {
    const capabilities = await capabilitiesFor(workspaceRoot);
    const files = [];
    for (const t of targets) {
      const language = languageForPath(t.file);
      if (language !== null) files.push({ file: t.file, absPath: t.absPath, language });
    }
    const context = createAnalysisContext({ root: workspaceRoot, capabilities, files });

    // Collect findings grouped by file, then post one batch per file. A file with no findings sends
    // no message — main clears the workspace's findings at run start, so it correctly ends up empty.
    const byFile = new Map();
    for await (const finding of analyzeWorkspace({ context }, controller.signal)) {
      const list = byFile.get(finding.location.file);
      if (list === undefined) byFile.set(finding.location.file, [finding]);
      else list.push(finding);
    }
    for (const [file, findings] of byFile) {
      if (controller.signal.aborted) break;
      port.postMessage({ type: 'fileFindings', jobId, file, findings });
    }
    port.postMessage({ type: 'done', jobId, aborted: controller.signal.aborted });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  } finally {
    jobs.delete(jobId);
  }
}
