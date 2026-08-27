import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drives the REAL `startMcpServer()` (JSON-RPC over stdio) by faking `node:readline`'s
 * `createInterface` to capture the 'line' callback and calling it directly — the same shape the
 * real transport uses, without a real stdin. `getHandler` is mocked so each test controls exactly
 * what the four tools dispatch to, without a real IPC router or DB.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getName: () => 'fixora' },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('node:readline', () => {
  const createInterface = vi.fn();
  return { createInterface, default: { createInterface } };
});

vi.mock('../electron/main/ipc/router.js', () => ({ getHandler: vi.fn() }));

type Handler = (req: unknown, ctx: { requestId: string; window: null }) => unknown;
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

async function setup(handlers: Partial<Record<string, Handler>> = {}): Promise<{
  send: (obj: unknown) => Promise<void>;
  sendRaw: (raw: string) => Promise<void>;
  responses: () => JsonRpcResponse[];
  handlerMock: (channel: string) => Handler | undefined;
}> {
  vi.resetModules();

  const { createInterface } = await import('node:readline');
  const lineCallbacks: ((line: string) => void)[] = [];
  vi.mocked(createInterface).mockReturnValue({
    on: (event: string, cb: (line: string) => void) => {
      if (event === 'line') lineCallbacks.push(cb);
    },
  } as never);

  const { getHandler } = await import('../electron/main/ipc/router.js');
  const handlerMock = (channel: string): Handler | undefined => handlers[channel];
  vi.mocked(getHandler).mockImplementation(handlerMock as never);

  const writes: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });

  const { startMcpServer } = await import('../electron/main/mcp/mcp-server.js');
  startMcpServer();

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  return {
    send: async (obj) => {
      lineCallbacks.forEach((cb) => {
        cb(JSON.stringify(obj));
      });
      await flush();
    },
    sendRaw: async (raw) => {
      lineCallbacks.forEach((cb) => {
        cb(raw);
      });
      await flush();
    },
    responses: () => writes.map((w) => JSON.parse(w.trim()) as JsonRpcResponse),
    handlerMock,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('JSON-RPC protocol handling', () => {
  it('initialize request returns server info and capabilities', async () => {
    const { send, responses } = await setup();
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const [res] = responses();
    expect(res?.result).toEqual({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixora', version: '1.0.0' },
    });
  });

  it('tools/list returns all 4 tools with schemas', async () => {
    const { send, responses } = await setup();
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const [res] = responses();
    const tools = (res?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      'fixora_analyze',
      'fixora_repair',
      'fixora_findings',
      'fixora_status',
    ]);
    expect(tools.every((t) => 'inputSchema' in t)).toBe(true);
  });

  it('tools/call with valid tool dispatches to handler', async () => {
    const status = vi.fn().mockReturnValue({ projectPath: null, aiConfigured: false, findingsCount: 0 });
    const { send, responses } = await setup({ 'mcp:getStatus': status });
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixora_status' } });
    expect(status).toHaveBeenCalledTimes(1);
    const [res] = responses();
    expect(res?.error).toBeUndefined();
  });

  it('unknown tool name returns a tool error (-32000, not a protocol error)', async () => {
    // Real behavior: an unknown TOOL name throws inside `callTool`, caught by the same catch that
    // wraps every tool error — -32601 is reserved for an unknown top-level RPC *method*, not this.
    const { send, responses } = await setup();
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'not_a_tool' } });
    const [res] = responses();
    expect(res?.error?.code).toBe(-32000);
    expect(res?.error?.message).toContain('Unknown tool');
  });

  it('invalid JSON returns -32700 parse error', async () => {
    const { sendRaw, responses } = await setup();
    await sendRaw('not json{');
    const [res] = responses();
    expect(res?.error).toEqual({ code: -32700, message: 'Parse error' });
  });

  it('missing method returns -32600 invalid request error', async () => {
    const { send, responses } = await setup();
    await send({ jsonrpc: '2.0', id: 5 });
    const [res] = responses();
    expect(res?.error).toEqual({ code: -32600, message: 'Invalid Request' });
    expect(res?.id).toBe(5);
  });

  it('missing tool name in tools/call returns -32602 error', async () => {
    const { send, responses } = await setup();
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} });
    const [res] = responses();
    expect(res?.error).toEqual({ code: -32602, message: 'Missing tool name' });
  });
});

describe('MCP rate limiter', () => {
  it('fixora_analyze allows up to 3 calls per 60s', async () => {
    const analyze = vi.fn().mockReturnValue({ findings: [] });
    const { send, responses } = await setup({ 'mcp:analyzeFile': analyze });
    for (let i = 0; i < 3; i += 1) {
      await send({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
      });
    }
    expect(responses().every((r) => r.error === undefined)).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it('fixora_analyze blocks 4th call with rate limit error', async () => {
    const analyze = vi.fn().mockReturnValue({ findings: [] });
    const { send, responses } = await setup({ 'mcp:analyzeFile': analyze });
    for (let i = 0; i < 4; i += 1) {
      await send({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
      });
    }
    const last = responses().at(-1);
    expect(last?.error?.code).toBe(-32000);
    expect(last?.error?.message).toContain('Rate limit exceeded');
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it('rate limit resets after 60s window', async () => {
    vi.useFakeTimers();
    const analyze = vi.fn().mockReturnValue({ findings: [] });
    const { send, responses } = await setup({ 'mcp:analyzeFile': analyze });
    for (let i = 0; i < 3; i += 1) {
      await send({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
      });
    }
    vi.advanceTimersByTime(60_001);
    await send({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
    });
    const last = responses().at(-1);
    expect(last?.error).toBeUndefined();
    expect(analyze).toHaveBeenCalledTimes(4);
  });

  it('different tools have independent rate limits', async () => {
    const analyze = vi.fn().mockReturnValue({ findings: [] });
    const repair = vi.fn().mockResolvedValue({ applied: false, message: 'no-op' });
    const { send, responses } = await setup({
      'mcp:analyzeFile': analyze,
      'mcp:repairFinding': repair,
    });
    for (let i = 0; i < 3; i += 1) {
      await send({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
      });
    }
    await send({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: { name: 'fixora_repair', arguments: { findingId: 'f1' } },
    });
    const last = responses().at(-1);
    expect(last?.error).toBeUndefined();
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('read-only tools (fixora_findings) have a higher limit', async () => {
    const findings = vi.fn().mockReturnValue({ findings: [] });
    const { send, responses } = await setup({ 'mcp:getFindings': findings });
    for (let i = 0; i < 4; i += 1) {
      await send({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'fixora_findings' } });
    }
    expect(responses().every((r) => r.error === undefined)).toBe(true);
    expect(findings).toHaveBeenCalledTimes(4);
  });
});

describe('tool dispatch', () => {
  it('fixora_analyze calls mcp:analyzeFile handler', async () => {
    const analyze = vi.fn().mockReturnValue({ findings: [] });
    const { send } = await setup({ 'mcp:analyzeFile': analyze });
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'fixora_analyze', arguments: { file: '/a.ts' } },
    });
    expect(analyze).toHaveBeenCalledWith(
      { file: '/a.ts' },
      expect.objectContaining({ window: null }),
    );
  });

  it('fixora_repair calls mcp:repairFinding handler', async () => {
    const repair = vi.fn().mockResolvedValue({ applied: true, message: 'Repair applied.' });
    const { send } = await setup({ 'mcp:repairFinding': repair });
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'fixora_repair', arguments: { findingId: 'f1' } },
    });
    expect(repair).toHaveBeenCalledWith(
      { findingId: 'f1' },
      expect.objectContaining({ window: null }),
    );
  });

  it('fixora_findings calls mcp:getFindings handler', async () => {
    const findings = vi.fn().mockReturnValue({ findings: [] });
    const { send } = await setup({ 'mcp:getFindings': findings });
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixora_findings' } });
    expect(findings).toHaveBeenCalledWith({}, expect.objectContaining({ window: null }));
  });

  it('fixora_status calls mcp:getStatus handler', async () => {
    const status = vi.fn().mockReturnValue({ projectPath: null, aiConfigured: false, findingsCount: 0 });
    const { send } = await setup({ 'mcp:getStatus': status });
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixora_status' } });
    expect(status).toHaveBeenCalledWith({}, expect.objectContaining({ window: null }));
  });

  it('handler error returns -32000 tool error', async () => {
    const status = vi.fn().mockRejectedValue(new Error('boom'));
    const { send, responses } = await setup({ 'mcp:getStatus': status });
    await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixora_status' } });
    const [res] = responses();
    expect(res?.error).toEqual({ code: -32000, message: 'boom' });
  });
});
