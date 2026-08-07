import { type AppInfo } from '@fixora/shared-types';
import { app, clipboard, shell } from 'electron';

import type { GpuPreferenceStore } from '../../gpu-preference-store.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

const CHANGELOG_URL = 'https://api.github.com/repos/NOVAA-STUDIOS/fixora/releases?per_page=10';
const CHANGELOG_TIMEOUT_MS = 8000;

type GithubRelease = { tag_name?: string; published_at?: string; body?: string | null };
type ChangelogEntry = { version: string; date: string; body: string };

// Session-lifetime cache — the dialog reopening (e.g. clicking the quick action again) must not
// re-hit the network every time; a fresh app launch is a fresh cache, which is fine since a new
// release landing mid-session is not something the user needs pushed to them.
let cached: ChangelogEntry[] | null = null;

async function fetchChangelog(): Promise<ChangelogEntry[]> {
  if (cached !== null) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CHANGELOG_TIMEOUT_MS);
  try {
    const res = await fetch(CHANGELOG_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const releases = (await res.json()) as GithubRelease[];
    if (!Array.isArray(releases)) return [];
    const entries = releases
      .filter((r): r is GithubRelease & { tag_name: string } => typeof r.tag_name === 'string')
      .map((r) => ({
        version: r.tag_name,
        date: r.published_at ?? '',
        body: r.body ?? '',
      }));
    cached = entries;
    return entries;
  } catch {
    return []; // offline, timed out, or a malformed response — degrades to "no releases", not an error
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one M0 channel. It exists to prove the whole path — renderer → preload → router →
 * handler → validated response → typed Result — with a payload that carries nothing sensitive,
 * so the pattern can be reviewed on its merits before it is carrying a user's source code.
 */
export function registerSystemHandlers(deps: {
  workspace: WorkspaceService;
  gpuPreference: GpuPreferenceStore | null;
}): void {
  registerHandler('system:getAppInfo', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      commit: typeof __FIXORA_COMMIT__ === 'string' ? __FIXORA_COMMIT__ : 'unknown',
      builtAt: typeof __FIXORA_BUILT_AT__ === 'string' ? __FIXORA_BUILT_AT__ : 'unknown',
      dirty: typeof __FIXORA_DIRTY__ === 'boolean' ? __FIXORA_DIRTY__ : false,
      platform: process.platform as AppInfo['platform'],
      arch: process.arch,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
    };
  });

  registerHandler('system:getChangelog', async () => {
    return { releases: await fetchChangelog() };
  });

  registerHandler('system:getGpuPreference', () => ({
    disableCompositing: deps.gpuPreference?.shouldDisableCompositing() ?? false,
    platformSupported: deps.gpuPreference !== null,
  }));

  registerHandler('system:setGpuCompositingDisabled', ({ disabled }) => {
    deps.gpuPreference?.setUserPreference(disabled);
  });

  registerHandler('system:copyToClipboard', ({ text }) => {
    // Refuse empty writes rather than silently clearing the user's clipboard: "Copy" that wipes what
    // you had is worse than "Copy" that tells you there was nothing to copy.
    if (text.length === 0) return { copied: false };
    clipboard.writeText(text);
    return { copied: true };
  });

  registerHandler('system:revealInFolder', ({ path }) => {
    // Same rule as workspace:open — a renderer-supplied path is only honoured if the user already
    // authorized it (a pick this session, or a known recent). Without this the channel would let a
    // compromised renderer open a native file-manager window on any path it can name.
    if (!deps.workspace.isUserAuthorized(path)) return { revealed: false };
    shell.showItemInFolder(path);
    return { revealed: true };
  });
}
