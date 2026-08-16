// The analysis utility process (ADR-017). It runs the deterministic engine in an OS-isolated
// process so a runaway parse, a backtracking Semgrep rule, or a slow type-check can be timed out and
// killed without freezing the editor. It is intentionally thin: main owns the workspace root and vets
// which files may be read (path guard + secrets denylist + ignore); the worker derives each file's
// language, detects the workspace's tools, runs every analyzer ONCE over the whole set, and streams
// the findings back grouped by file.
//
// ESM on purpose: the engine (`@fixora/core-analysis`) is ESM and loads tree-sitter WASM via
// `import.meta.url`, which only works when it is imported as a real module, not bundled into CJS.
import { readFileSync, writeFileSync } from 'node:fs';

import {
  analyzeWorkspace,
  createFindingCache,
  createAnalysisContext,
  deterministicRepair,
  detectCapabilities,
  formatGate,
  hasSemgrepConfig,
  isTailwindDirectiveLine,
  languageForPath,
  parse,
  resolveEditScope,
} from '@fixora/core-analysis';

const port = process.parentPort;
/** jobId -> AbortController, so a cancel message stops the matching run. */
const jobs = new Map();
/** workspaceRoot -> detected capabilities; detection spawns `tool --version` probes. */
const capabilitiesByRoot = new Map();
/**
 * Findings for files nobody has touched, keyed by content hash. In memory only, and consulted only
 * for analyzers that declare `fileLocal` — see `finding-cache.ts` for why eslint and tsc are excluded
 * on correctness grounds rather than by oversight.
 *
 * Dropped when the workspace root changes: a cache surviving a switch would answer for the wrong
 * project entirely.
 *
 * NOT dropped on Re-run, deliberately. Re-run is the only thing that starts an analysis at all, so
 * clearing here would mean the cache was never once read. It is keyed on content hash, which already
 * gives Re-run what it is actually for: files the user edited are re-analyzed, files they did not are
 * not, and eslint and tsc re-run in full every time regardless.
 */
const findingCache = createFindingCache();
let cacheRoot = null;

function cacheFor(root) {
  if (cacheRoot !== root) {
    findingCache.clear();
    cacheRoot = root;
  }
  return findingCache;
}

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
    return;
  }
  if (message.type === 'format') {
    void runFormat(message);
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
 * Format-on-save. `formatGate` mutates `absFile` in place when a formatter is available and the
 * file is well-formed; this re-reads it afterward so main gets the post-format content back in
 * the same round trip rather than a second `fs:readFile` call. `content` is always the file's
 * current bytes, whether or not formatting ran or changed anything — the caller does not need to
 * special-case "nothing happened".
 */
async function runFormat({ jobId, root, absFile, language }) {
  try {
    const result = await formatGate({ root, absFile, language });
    const content = readFileSync(absFile, 'utf8');
    port.postMessage({
      type: 'formatResult',
      jobId,
      ran: result.ran,
      ok: result.ok,
      formatter: result.formatter ?? null,
      message: result.message ?? null,
      content,
    });
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
/**
 * `skipLine(line)` lets the caller veto an error by its 1-based source line. CSS uses it to ignore
 * the Tailwind v4 directives the grammar cannot read: they are valid Tailwind, the analyzer already
 * treats them as such, and without the same veto here the verifier reported "the patched file does
 * not parse" for every repair in a Tailwind stylesheet — refusing Apply on good patches.
 */
const SPLIT_EOL = /\r?\n/;

/**
 * Every syntax defect in a tree, as a set of stable signatures (node type + its text).
 *
 * Line numbers deliberately play no part: a patch shifts them, and a pre-existing defect further
 * down the file would otherwise look brand new. Comparing the PATCHED set against the ORIGINAL one
 * is what lets the gate report only what the patch actually introduced.
 */
function syntaxSignatures(root, skipLine = () => false) {
  const out = new Set();
  const flag = (node, name) => {
    const v = node[name];
    return typeof v === 'function' ? v.call(node) : v === true;
  };
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type === 'ERROR' || flag(child, 'isError') || flag(child, 'isMissing')) {
        if (!skipLine(child.startPosition.row + 1)) {
          out.add(child.type + '\u0000' + (flag(child, 'isMissing') ? '<missing>' : child.text.trim()));
        }
        continue;
      }
      const hasError = typeof child.hasError === 'function' ? child.hasError() : child.hasError;
      if (hasError) visit(child);
    }
  };
  visit(root);
  return out;
}

function firstSyntaxError(root, skipLine = () => false) {
  const flag = (node, name) => {
    const v = node[name];
    return typeof v === 'function' ? v.call(node) : v === true;
  };
  const visit = (node) => {
    for (const child of node.children) {
      if (child.type === 'ERROR' || flag(child, 'isError') || flag(child, 'isMissing')) {
        const missing = flag(child, 'isMissing');
        if (skipLine(child.startPosition.row + 1)) continue;
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
  return visit(root);
}

/**
 * Verify a repair (ADR-003). The overlay root already has the patched file on disk; we (1) parse it to
 * confirm the fix did not break syntax, then (2) re-run the analyzers on that one file. Main compares
 * the resulting findings against the original to decide verified / regression / unresolved. Tiered and
 * honest: this is static analysis + syntax; tests are a later, opt-in tier.
 */
async function runVerify(message) {
  const { jobId, workspaceRoot, target, originalSource } = message;
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
      // `hasError` is the tree's own verdict and knows nothing about Tailwind, so it cannot be the
      // gate on its own: a Tailwind v4 stylesheet always has `hasError === true` because of its
      // `@source`/`@plugin`/`@variant` lines, which made every repair in such a file unappliable.
      // The gate is the first error that SURVIVES the same veto the analyzer applies, so both sides
      // agree on what counts as broken. A file with a genuine defect still fails, exactly as before.
      const lines = source.split(SPLIT_EOL);
      const skipLine =
        target.language === 'css'
          ? (line) => isTailwindDirectiveLine(lines[line - 1] ?? '')
          : () => false;
      // The parser gate must say WHERE, not just whether. Walk to the first ERROR/MISSING node so the
      // UI can show "Parser failed at line N" instead of a bare "does not parse".
      syntaxError = tree.root.hasError ? firstSyntaxError(tree.root, skipLine) : null;
      syntaxOk = syntaxError === null;

      // Differential gate. The grammar can be older than the language it parses — tree-sitter-css
      // rejects comma-separated keyframe selectors and :where()/:is() with complex arguments, both
      // valid and both common. Judged absolutely, every repair in such a file is refused over a defect on
      // a line the patch never touched. So a defect that ALSO exists in the original is not charged
      // to the patch. Anything the patch actually introduced is still a new signature, still fails,
      // and the gate is not weakened: this can only ever forgive what was already there.
      if (!syntaxOk && typeof originalSource === 'string') {
        let before = null;
        try {
          before = await parse(target.language, originalSource, target.file);
          const had = syntaxSignatures(before.root, skipLine);
          const now = syntaxSignatures(tree.root, skipLine);
          let introduced = false;
          for (const sig of now) {
            if (!had.has(sig)) { introduced = true; break; }
          }
          if (!introduced) {
            syntaxOk = true;
            syntaxError = null;
          }
        } catch {
          // Could not read the original — keep the strict verdict rather than guess in the
          // patch's favour.
        } finally {
          before?.dispose();
        }
      }
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

    /**
     * The BASELINE, computed here rather than read from the database.
     *
     * Verification compares two sets of findings, and it used to source them from two different
     * places: the patched set from this overlay, the baseline from the database's last workspace
     * analysis. Those describe different moments and, potentially, different content. Measured on the
     * real pipeline, a user who edited the file after analysis got `regression` on a correct patch,
     * because their OWN new type error was absent from the stale baseline and so looked like
     * something the patch introduced. Apply was disabled over a defect the patch never touched.
     *
     * Analyzing the unpatched content here — same overlay, same capabilities, same analyzers, same
     * moment — makes the comparison apples-to-apples. The only difference between the two sets is now
     * the patch itself, which is the only difference a verdict is entitled to talk about.
     *
     * Costs one extra single-file analysis per verification. That is the price of a verdict that is
     * about the patch rather than about elapsed time.
     */
    let baselineFindings;
    if (typeof originalSource === 'string') {
      const patchedBytes = readFileSync(target.absPath, 'utf8');
      try {
        writeFileSync(target.absPath, originalSource, 'utf8');
        const baseline = [];
        const baselineContext = createAnalysisContext({
          root: workspaceRoot,
          capabilities,
          files: [target],
        });
        for await (const finding of analyzeWorkspace({ context: baselineContext }, controller.signal)) {
          baseline.push(finding);
        }
        baselineFindings = baseline;
      } catch {
        // Could not analyze the original — fall back to the caller's baseline rather than guess.
        // `baselineFindings` stays undefined, which is exactly how the caller reads "I have none".
      } finally {
        // The overlay is disposable, but the patched bytes must be back before the formatter gate
        // below reads them, or it would judge the ORIGINAL file and report the wrong result.
        writeFileSync(target.absPath, patchedBytes, 'utf8');
      }
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
      // The same-environment baseline, when it could be computed. Absent means the caller should use
      // its own — see the block above.
      ...(baselineFindings !== undefined ? { baselineFindings } : {}),
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
    // The run's reliability notices (NOV7-01): a tool killed at its timeout must be reported, not
    // silently become "zero findings". `reportNotice` is the context's sink; main forwards the
    // collected notices to the renderer, which shows them as warnings on the analysis state.
    const notices = [];
    // Semgrep runs only when the workspace ships its own config (no network fetch — ADR-007), so
    // a project with no .semgrep.yml gets zero Semgrep findings with nothing distinguishing that
    // from "Semgrep found nothing". Told apart from "no semgrep binary at all", which needs no
    // action from the user and would be a useless notice.
    if (capabilities.tools.has('semgrep') && !hasSemgrepConfig(workspaceRoot)) {
      notices.push({
        analyzerId: 'semgrep',
        tool: 'semgrep',
        timeoutMs: 0,
        message:
          'Semgrep inactive — no .semgrep.yml found in project root. Add one to enable ' +
          'cross-language security scanning.',
      });
    }
    const context = createAnalysisContext({
      root: workspaceRoot,
      capabilities,
      files,
      reportNotice: (notice) => {
        notices.push(notice);
      },
    });
    const cache = cacheFor(workspaceRoot);

    // Grouped by file per message (one `fileFindings` per file, not per finding — that would be
    // thousands of IPC round-trips on a large repo) but flushed as findings actually arrive, not
    // buffered until the whole run ends. `analyzeWorkspace` is built to stream incrementally (see
    // engine.ts) precisely so a large project's panel fills in as it goes; draining the generator
    // into one map before posting anything threw that away — main's progress counter and the
    // panel's live findings both sat frozen until the entire run finished, on a project where that
    // could be minutes. A file with no findings still sends no message — main clears the
    // workspace's findings at run start, so it correctly ends up empty.
    const FLUSH_EVERY = 25; // findings accumulated since the last flush
    const byFile = new Map();
    let sinceFlush = 0;
    const flush = () => {
      for (const [file, findings] of byFile) {
        port.postMessage({ type: 'fileFindings', jobId, file, findings });
      }
      byFile.clear();
      sinceFlush = 0;
    };
    for await (const finding of analyzeWorkspace({ context, cache }, controller.signal)) {
      const list = byFile.get(finding.location.file);
      if (list === undefined) byFile.set(finding.location.file, [finding]);
      else list.push(finding);
      sinceFlush += 1;
      if (sinceFlush >= FLUSH_EVERY) flush();
    }
    if (!controller.signal.aborted) flush();
    port.postMessage({ type: 'done', jobId, aborted: controller.signal.aborted, notices });
  } catch (error) {
    port.postMessage({ type: 'error', jobId, message: String(error) });
  } finally {
    jobs.delete(jobId);
  }
}
