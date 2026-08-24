import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';

const CALL_TIMEOUT_MS = 30_000;

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal stdio JSON-RPC client for Fixora's `--mcp` server. Spawns the process on first use and
 * respawns it if it dies mid-session, so a crashed server doesn't strand the extension until a
 * VS Code reload.
 */
export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  constructor(private readonly exePath: string) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected();
    const id = this.nextId++;
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Fixora MCP call "${name}" timed out after ${String(CALL_TIMEOUT_MS)}ms`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const child = this.child;
      if (!child) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Fixora MCP client is not connected'));
        return;
      }
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private ensureConnected(): void {
    if (this.child && !this.child.killed) return;

    const child = spawn(this.exePath, ['--mcp'], { stdio: 'pipe' });
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      this.handleLine(line);
    });
    this.rl = rl;

    child.on('exit', () => {
      this.rejectAllPending(new Error('Fixora MCP process exited'));
      this.child = null;
      this.rl?.close();
      this.rl = null;
    });
  }

  private handleLine(line: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    const call = this.pending.get(parsed.id);
    if (!call) return;
    this.pending.delete(parsed.id);
    clearTimeout(call.timer);
    if (parsed.error) {
      call.reject(new Error(parsed.error.message));
    } else {
      call.resolve(parsed.result);
    }
  }

  private rejectAllPending(reason: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(reason);
    }
    this.pending.clear();
  }

  dispose(): void {
    this.rejectAllPending(new Error('Fixora MCP client disposed'));
    this.rl?.close();
    this.rl = null;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}
