import { relative, sep } from 'node:path';

import type { CredentialStore } from '../../ai/credentials/credential-store.js';
import { anyProviderConfigured } from '../../ai/providers/orchestrator.js';
import type { ProviderRegistry } from '../../ai/providers/provider-registry.js';
import type { AnalysisService } from '../../analysis/analysis-service.js';
import type { FindingsRepository } from '../../db/repositories.js';
import { isMcpEnabled, setMcpEnabled } from '../../lib/mcp-setting.js';
import { peekRepairLimit } from '../../lib/repair-limit.js';
import { assertInsideWorkspace } from '../../services/fs/path-guard.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { getHandler, registerHandler } from '../router.js';

/**
 * Backs the embedded MCP server's four tools (feature #10). Registered as ordinary IPC handlers —
 * callable from the renderer too, though nothing there does — so `mcp-server.ts` can reuse the
 * exact same logic via `getHandler()` in-process instead of duplicating it.
 */
export function registerMcpHandlers(deps: {
  workspace: WorkspaceService;
  findings: FindingsRepository;
  analysis: AnalysisService;
  registry: ProviderRegistry;
  credentials: CredentialStore;
  /** Whether the stdio server actually started this launch — decided in `index.ts`. */
  isRunning: () => boolean;
}): void {
  registerHandler('mcp:getFindings', () => {
    const open = deps.workspace.getCurrent();
    if (open === null) return { findings: [] };
    return {
      findings: deps.findings.list(open.id).map((f) => ({
        id: f.id,
        ruleId: f.ruleId,
        severity: f.severity,
        category: f.category,
        message: f.message,
        file: f.location.file,
        line: f.location.startLine,
      })),
    };
  });

  registerHandler('mcp:triggerAnalysis', (_req, { window }) => {
    const open = deps.workspace.getCurrent();
    if (open === null) return { started: false, message: 'No project is open.' };
    if (window === null) {
      return { started: false, message: 'No window is available to run analysis against.' };
    }
    deps.analysis.run(window);
    return { started: true, message: `Analysis started for ${open.rootPath}.` };
  });

  registerHandler('mcp:analyzeFile', async ({ file }) => {
    const open = deps.workspace.getCurrent();
    if (open === null) return { findings: [], error: 'No project is open.' };
    if (file.trim() === '') return { findings: [], error: 'file param required' };

    let resolvedAbs: string;
    try {
      resolvedAbs = assertInsideWorkspace(file, open.rootPath);
    } catch {
      return { findings: [], error: 'file param required' };
    }
    const relPath = relative(open.rootPath, resolvedAbs).split(sep).join('/');

    // No renderer window backs a headless MCP caller — `analyzeFile` accepts `null` for exactly
    // this case and reports the outcome through its return value instead of an emitted event.
    const outcome = await deps.analysis.analyzeFile(null, relPath);
    if (!outcome.ok) return { findings: [], error: 'Analysis failed.' };

    return {
      findings: deps.findings.list(open.id, { relPath }).map((f) => ({
        id: f.id,
        ruleId: f.ruleId,
        severity: f.severity,
        category: f.category,
        message: f.message,
        file: f.location.file,
        line: f.location.startLine,
      })),
    };
  });

  registerHandler('mcp:repairFinding', async ({ findingId }, ctx) => {
    // MCP is a repair path like any other and is metered like any other — without this it was a
    // paywall bypass with no tampering required. Checked (not consumed) here; `ai:run` below
    // consumes the allowance, so one repair costs exactly one.
    const limit = peekRepairLimit();
    if (!limit.allowed) {
      return { applied: false, message: limit.message ?? 'Repair limit reached for this window.' };
    }

    const run = getHandler('ai:run');
    const apply = getHandler('ai:applyRepair');
    if (run === undefined || apply === undefined) {
      return { applied: false, message: 'Repair pipeline is not available.' };
    }

    const response = await run({ profile: 'repair', findingId }, ctx);
    if (response.status !== 'ok' || response.proposal.profile !== 'repair') {
      return {
        applied: false,
        message: response.status === 'error' ? response.message : `Repair did not complete (status: ${response.status}).`,
      };
    }
    const proposal = response.proposal;
    if (proposal.verification.verdict === 'regression' || !proposal.verification.syntaxOk) {
      return { applied: false, message: 'The proposed repair failed verification and was not applied.' };
    }

    const outcome = await apply(
      {
        file: proposal.target.file,
        startLine: proposal.target.startLine,
        endLine: proposal.target.endLine,
        code: proposal.repairedCode,
        expectedOriginal: proposal.originalCode,
        historyId: proposal.historyId,
      },
      ctx,
    );
    return {
      applied: outcome.applied,
      message: outcome.applied ? 'Repair applied.' : outcome.message,
    };
  });

  registerHandler('mcp:getSetting', () => ({
    enabled: isMcpEnabled(),
    running: deps.isRunning(),
  }));

  registerHandler('mcp:setEnabled', ({ enabled }) => {
    setMcpEnabled(enabled);
    // `running` deliberately reports the CURRENT process: turning the setting on does not start a
    // server mid-flight (stdio is claimed at launch), and saying otherwise would be a lie the
    // settings toggle tells about a capability that writes to source files.
    return { enabled, running: deps.isRunning() };
  });

  registerHandler('mcp:getStatus', () => {
    const open = deps.workspace.getCurrent();
    return {
      projectPath: open?.rootPath ?? null,
      aiConfigured: anyProviderConfigured(deps.registry, deps.credentials),
      findingsCount: open === null ? 0 : deps.findings.list(open.id).length,
    };
  });
}
