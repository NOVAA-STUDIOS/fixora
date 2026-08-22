import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether the embedded MCP server may run — **off unless the user turned it on**.
 *
 * The `--mcp` flag alone is not consent. Anything that can spawn this executable can pass a flag,
 * and an MCP client that connects gets repair authority over whatever project is open — writes to
 * the user's source, with none of the review-the-diff-then-Apply gating the UI enforces. So the
 * flag now only says "start it if allowed", and this setting is what says "allowed".
 *
 * Main-owned on disk, like the repair limit: a capability this consequential must not be togglable
 * from the untrusted side, and must survive being read before any window exists.
 */

interface Stored {
  enabled: boolean;
}

let file: string | null = null;
let enabled = false;

export function initMcpSetting(dir: string): void {
  file = join(dir, 'mcp-setting.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
    // Anything that is not exactly `true` — absent, corrupt, hand-edited to nonsense — is off.
    enabled = parsed.enabled === true;
  } catch {
    enabled = false;
  }
}

export function isMcpEnabled(): boolean {
  return enabled;
}

export function setMcpEnabled(next: boolean): void {
  enabled = next;
  if (file === null) return;
  try {
    writeFileSync(file, JSON.stringify({ enabled: next } satisfies Stored), 'utf8');
  } catch (error) {
    console.error('[mcp] could not persist setting', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
