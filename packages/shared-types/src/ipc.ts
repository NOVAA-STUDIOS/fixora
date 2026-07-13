import { z } from 'zod';

/**
 * **The entire renderer → main attack surface, enumerable in one file** (ADR-018, TDD §4).
 *
 * The renderer is a browser. It runs a large dependency tree and, from M2, an editor that
 * renders the user's own source code — i.e. untrusted content. Treat it as hostile. Every
 * channel is declared once here as a request/response schema pair, the router validates
 * **both directions** at runtime, and the preload exposes a frozen object built from this
 * registry. `ipcRenderer` never reaches the renderer.
 *
 * Adding a channel is the moment to ask whether the renderer should be able to do this at all.
 * That question is easy to ask here and impossible to ask when the surface is spread across
 * forty `ipcMain.handle` calls.
 */

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  arch: z.string(),
  electronVersion: z.string(),
  isPackaged: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

/**
 * The M0 channel set is exactly one channel, and that is the point: it proves the pattern
 * end-to-end (renderer → preload → router → handler → validated response) with no product
 * surface to hide behind. Workspace, filesystem, analysis, AI and patch channels arrive with
 * the milestones that implement them — a declared channel with no handler is a placeholder,
 * and Standards §2 does not allow those.
 */
export const contracts = {
  'system:getAppInfo': {
    request: z.object({}),
    response: AppInfoSchema,
  },
} as const;

export type Contracts = typeof contracts;
export type Channel = keyof Contracts;

export type RequestOf<C extends Channel> = z.infer<Contracts[C]['request']>;
export type ResponseOf<C extends Channel> = z.infer<Contracts[C]['response']>;

export const channels = Object.keys(contracts) as Channel[];

export function isChannel(value: string): value is Channel {
  return Object.hasOwn(contracts, value);
}
