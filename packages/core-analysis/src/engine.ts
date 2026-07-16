import type { Finding } from '@fixora/shared-types';

import type { AnalysisContext, Analyzer } from './analyzer.js';
import { applicableAnalyzers, defaultAnalyzers } from './registry.js';

/**
 * The engine: run every applicable analyzer over the workspace and stream findings as they arrive, so
 * the panel fills incrementally rather than blocking on the slowest tool. Each analyzer runs **once**
 * (its `run()` iterates the files itself), which is what makes analysis scale — an external tool is
 * spawned a single time, not per file. Cancellation stops the whole run promptly.
 */

export interface AnalyzeWorkspaceOptions {
  context: AnalysisContext;
  /** Defaults to the full roster; injectable for tests and for a reduced run. */
  analyzers?: readonly Analyzer[];
}

export async function* analyzeWorkspace(
  options: AnalyzeWorkspaceOptions,
  signal: AbortSignal,
): AsyncIterable<Finding> {
  const analyzers = options.analyzers ?? defaultAnalyzers();
  for (const analyzer of applicableAnalyzers(analyzers, options.context.capabilities)) {
    if (signal.aborted) return;
    yield* analyzer.run(options.context, signal);
  }
}
