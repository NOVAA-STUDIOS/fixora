import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ShieldSensitivity, ShieldSettings } from '@fixora/shared-types';

/**
 * Code Shield's own settings, main-owned on disk like `mcp-setting.ts`.
 *
 * On by default — unlike MCP, the Shield only ever READS: it re-runs analyzers the app already runs
 * and reports what they found. It writes nothing, sends nothing, and spends no provider credit, so
 * there is no capability here to withhold until asked.
 */

const SENSITIVITIES: readonly ShieldSensitivity[] = ['strict', 'balanced', 'relaxed'];

const DEFAULTS: ShieldSettings = { enabled: true, sensitivity: 'balanced' };

let file: string | null = null;
let current: ShieldSettings = DEFAULTS;

export function initShieldSettings(dir: string): void {
  file = join(dir, 'shield-settings.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ShieldSettings>;
    current = {
      // Only an explicit `false` turns it off; anything absent or corrupt falls back to the default.
      enabled: parsed.enabled !== false,
      sensitivity: SENSITIVITIES.includes(parsed.sensitivity as ShieldSensitivity)
        ? (parsed.sensitivity as ShieldSensitivity)
        : DEFAULTS.sensitivity,
    };
  } catch {
    current = DEFAULTS;
  }
}

export function getShieldSettings(): ShieldSettings {
  return current;
}

export function saveShieldSettings(next: ShieldSettings): ShieldSettings {
  current = {
    enabled: next.enabled,
    sensitivity: SENSITIVITIES.includes(next.sensitivity) ? next.sensitivity : DEFAULTS.sensitivity,
  };
  if (file !== null) {
    try {
      writeFileSync(file, JSON.stringify(current), 'utf8');
    } catch (error) {
      console.error('[shield] could not persist settings', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return current;
}
