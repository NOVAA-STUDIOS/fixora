import { createInterface } from 'node:readline';

import type { McpRequest, McpResponse, McpTool } from '@fixora/shared-types';

import { getHandler } from '../ipc/router.js';

/**
 * The embedded MCP server (feature #10). Speaks JSON-RPC 2.0 over stdio (one message per line —
 * the transport MCP clients like Claude Desktop expect for a locally-spawned server) and exposes
 * four tools backed by `mcp.handlers.ts`'s IPC handlers, called in-process via `getHandler()`
 * rather than a real IPC round trip (there is no renderer window on the other end of this).
 *
 * Started only behind an explicit opt-in (`--mcp` or `MCP_ENABLED=1`) — see `index.ts` — because a
 * process listening on stdio for a *different* client than Electron's own is not something every
 * launch should do silently.
 */

const TOOLS: readonly McpTool[] = [
  {
    name: 'fixora_analyze',
    description: 'Analyze one file and return its findings, as JSON.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Absolute path to file to analyze' } },
      required: ['file'],
    },
  },
  {
    name: 'fixora_repair',
    description: 'Repair a specific finding by id, through the same verified/gated pipeline the app UI uses.',
    inputSchema: {
      type: 'object',
      properties: { findingId: { type: 'string', description: 'The finding id to repair.' } },
      required: ['findingId'],
    },
  },
  {
    name: 'fixora_findings',
    description: 'Return the current findings for the open project, as JSON.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'fixora_status',
    description: 'Return app status: whether AI is configured, and the open project path.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** A no-op context: these calls never came from a renderer window and carry no real request id. */
function context(): { requestId: string; window: null } {
  return { requestId: `mcp-${String(Date.now())}`, window: null };
}

async function callTool(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case 'fixora_analyze': {
      const file = (args as { file?: unknown } | null)?.file;
      if (typeof file !== 'string' || file.length === 0) {
        throw new Error('fixora_analyze requires a string "file" argument');
      }
      const handler = getHandler('mcp:analyzeFile');
      if (handler === undefined) throw new Error('mcp:analyzeFile is not registered');
      return handler({ file }, context());
    }
    case 'fixora_findings': {
      const handler = getHandler('mcp:getFindings');
      if (handler === undefined) throw new Error('mcp:getFindings is not registered');
      return handler({}, context());
    }
    case 'fixora_status': {
      const handler = getHandler('mcp:getStatus');
      if (handler === undefined) throw new Error('mcp:getStatus is not registered');
      return handler({}, context());
    }
    case 'fixora_repair': {
      const findingId = (args as { findingId?: unknown } | null)?.findingId;
      if (typeof findingId !== 'string' || findingId.length === 0) {
        throw new Error('fixora_repair requires a string "findingId" argument');
      }
      const handler = getHandler('mcp:repairFinding');
      if (handler === undefined) throw new Error('mcp:repairFinding is not registered');
      return handler({ findingId }, context());
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function write(response: McpResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handleMessage(request: McpRequest): Promise<void> {
  try {
    if (request.method === 'initialize') {
      write({
        jsonrpc: '2.0',
        id: request.id,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixora', version: '1.0.0' } },
      });
      return;
    }
    if (request.method === 'tools/list') {
      write({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
      return;
    }
    if (request.method === 'tools/call') {
      const params = request.params as { name?: string; arguments?: unknown } | undefined;
      if (typeof params?.name !== 'string') {
        write({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Missing tool name' } });
        return;
      }
      const result = await callTool(params.name, params.arguments);
      write({
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      });
      return;
    }
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } });
  } catch (error) {
    write({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** Starts reading stdio. Every complete IPC handler must already be registered — call this only
 *  after `mountRouter()`/`assertEveryChannelIsHandled()` have run in `index.ts`. */
export function startMcpServer(): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      write({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const request = parsed as Partial<McpRequest>;
    if (request.jsonrpc !== '2.0' || request.id === undefined || typeof request.method !== 'string') {
      write({ jsonrpc: '2.0', id: request.id ?? 0, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    void handleMessage(request as McpRequest);
  });
  console.error('[mcp] server started (stdio)');
}
