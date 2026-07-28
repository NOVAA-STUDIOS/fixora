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
  deterministicRepair,
  detectCapabilities,
  formatGate,
  languageForPath,
  parse,
  resolveEditScope,
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
    return;
  }
  if (message.type === 'resolveScope') {
    void runResolveScope(message);
    return;
  }
  if (message.type === 'microRepair') {
    void runMicroRepair(message);
  }
});

/**
 * Proceed Mode scope selection (P2.2R). The AST lives here, in the worker, because tree-sitter is ESM
 * + WASM — so main asks for the smallest enclosing scope rather than parsing anything itself. This is
 * the engine's own `resolveEditScope`; nothing about scope selection is reimplemented on the main side.
 */
async function runResolveScope({
  jobId,
  source,
  language,
  filePath,
  selectionStartLine,
  selectionEndLine,
}) {
  try {
    const scope = await resolveEditScope({
      source,
      language,
      filePath,
      selectionStartLine,
      ...(selectionEndLine !== undefined ? { selectionEndLine } : {}),
    });
    port.postMessage({ type: 'scopeResult', jobId, scope });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  }
}

/**
 * Deterministic micro-repair (Q2 Fix #2A). Same reasoning as `runResolveScope`: `deterministicRepair`
 * depends on the ESM + tree-sitter-WASM engine, so it runs here rather than in main. This is the
 * engine's own `deterministicRepair` (ESLint/Ruff's own autofix, re-parsed for the parser gate) —
 * nothing about the fix itself is reimplemented on the main side. `result` is `null` when the finding
 * has no autofix or the edits could not be applied cleanly; that is a normal outcome, not an error.
 */
async function runMicroRepair({ jobId, finding, source, language, filePath }) {
  try {
    const result = await deterministicRepair({ finding, source, language, filePath });
    port.postMessage({ type: 'microRepairResult', jobId, result });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  }
}

/**
 * Locate the first syntax error in a parsed tree, as a 1-based line/column. Prunes with `hasError`
 * so it descends only the branch that actually contains the problem, and reports the ERROR or MISSING
 * node itself. Returns null if the tree is clean. Tolerant of tree-sitter exposing isError/isMissing
 * as either a property or a method across versions.
 */
function firstSyntaxError(root) {
  const flag = (node, name) => {
    const v = node[name];
    return typeof v === 'function' ? v.call(node) : v === true;
  };
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type === 'ERROR' || flag(child, 'isError') || flag(child, 'isMissing')) {
        const missing = flag(child, 'isMissing');
        return {
          line: child.startPosition.row + 1,
          column: child.startPosition.column + 1,
          text: missing ? `Missing ${child.type}` : `Unexpected syntax near '${child.type}'`,
        };
      }
      const hasError = typeof child.hasError === 'function' ? child.hasError() : child.hasError;
      if (hasError) {
        const deeper = visit(child);
        if (deeper !== null) return deeper;
      }
    }
    return null;
  };
  const found = visit(root);
  return found ?? { line: root.startPosition.row + 1, column: 1, text: 'Syntax error' };
}

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
    let syntaxError = null;
    try {
      const source = readFileSync(target.absPath, 'utf8');
      // Pass the path so a .tsx target is parsed with the JSX-aware grammar. Without it, a valid
      // React repair parses as plain TypeScript, every JSX tag is a syntax error, and the verdict
      // wrongly becomes "does not parse" — the bug that disabled Apply for every .tsx repair.
      const tree = await parse(target.language, source, target.file);
      syntaxOk = !tree.root.hasError;
      // The parser gate must say WHERE, not just whether. Walk to the first ERROR/MISSING node so the
      // UI can show "Parser failed at line N" instead of a bare "does not parse".
      if (!syntaxOk) syntaxError = firstSyntaxError(tree.root);
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

    // The formatter gate (Goals 4 & 9), run here in the worker where core-analysis is loaded and the
    // overlay copy lives. Skipped when the file does not parse — a formatter would only re-report the
    // syntax error the parser gate already owns.
    const formatter = syntaxOk
      ? await formatGate({
          root: workspaceRoot,
          absFile: target.absPath,
          language: target.language,
        })
      : { ran: false, ok: true };

    port.postMessage({
      type: 'verifyResult',
      jobId,
      syntaxOk,
      ...(syntaxError !== null ? { syntaxError } : {}),
      formatter,
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
