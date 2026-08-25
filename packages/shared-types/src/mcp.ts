import { z } from 'zod';

/**
 * MCP (Model Context Protocol) surface (feature #10). Fixora runs an embedded stdio MCP server in
 * the main process so external MCP clients (Claude Desktop, etc.) can drive analysis/repair on the
 * currently open project. These types describe the tool contract; the four `mcp:*` IPC channels
 * below are what the server calls internally (`getHandler`, not a real IPC round trip — the server
 * runs in-process) to reuse the exact same logic the renderer's own panels use.
 */

export const McpToolNameSchema = z.enum([
  'fixora_analyze',
  'fixora_repair',
  'fixora_findings',
  'fixora_status',
]);
export type McpToolName = z.infer<typeof McpToolNameSchema>;

export interface McpTool {
  readonly name: McpToolName;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, { type: string; description?: string }>;
    readonly required?: readonly string[];
  };
}

/** A JSON-RPC 2.0 request, the transport `mcp-server.ts` speaks over stdio. */
export interface McpRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface McpResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

const McpFindingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: z.string(),
  category: z.string(),
  message: z.string(),
  file: z.string(),
  line: z.number().int(),
});

export const McpGetFindingsResponseSchema = z.object({
  findings: z.array(McpFindingSchema),
});
export type McpGetFindingsResponse = z.infer<typeof McpGetFindingsResponseSchema>;

export const McpTriggerAnalysisResponseSchema = z.object({
  started: z.boolean(),
  message: z.string(),
});
export type McpTriggerAnalysisResponse = z.infer<typeof McpTriggerAnalysisResponseSchema>;

/** `fixora_analyze` (MCP tool): analyzes one file synchronously and returns its findings — unlike
 *  `mcp:triggerAnalysis` (a fire-and-forget full-project run against a renderer window), this needs
 *  neither a window nor the whole-project walk, which is what makes it usable from a headless
 *  `--mcp` standalone process. */
export const McpAnalyzeFileRequestSchema = z.object({ file: z.string().min(1) });
export type McpAnalyzeFileRequest = z.infer<typeof McpAnalyzeFileRequestSchema>;

export const McpAnalyzeFileResponseSchema = z.object({
  findings: z.array(McpFindingSchema),
  error: z.string().optional(),
});
export type McpAnalyzeFileResponse = z.infer<typeof McpAnalyzeFileResponseSchema>;

export const McpRepairFindingRequestSchema = z.object({ findingId: z.string().min(1) });
export type McpRepairFindingRequest = z.infer<typeof McpRepairFindingRequestSchema>;

export const McpRepairFindingResponseSchema = z.object({
  applied: z.boolean(),
  message: z.string(),
});
export type McpRepairFindingResponse = z.infer<typeof McpRepairFindingResponseSchema>;

export const McpGetStatusResponseSchema = z.object({
  projectPath: z.string().nullable(),
  aiConfigured: z.boolean(),
  findingsCount: z.number().int().nonnegative(),
});
export type McpGetStatusResponse = z.infer<typeof McpGetStatusResponseSchema>;
