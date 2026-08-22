import { create } from 'zustand';

import { invoke } from '../lib/bridge.js';

/**
 * The MCP capability switch. `enabled` is stored consent; `running` is whether the stdio server
 * actually started this launch — it needs BOTH the setting and a `--mcp`/`MCP_ENABLED=1` launch,
 * so the two are genuinely different facts and the UI must not conflate them.
 */
type McpState = {
  enabled: boolean;
  running: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

export const useMcpStore = create<McpState>((set) => ({
  enabled: false,
  running: false,

  load: async () => {
    const result = await invoke('mcp:getSetting', {});
    if (result.ok) set({ enabled: result.value.enabled, running: result.value.running });
  },

  setEnabled: async (enabled) => {
    const result = await invoke('mcp:setEnabled', { enabled });
    if (result.ok) set({ enabled: result.value.enabled, running: result.value.running });
  },
}));
