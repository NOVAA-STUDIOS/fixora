import { toast } from '../stores/toast-store.js';

import { invoke } from './bridge.js';

/**
 * Copy text to the clipboard, and say so.
 *
 * Every call site used to be `void navigator.clipboard.writeText(text)`, which had two independent
 * faults that combined into a silent no-op:
 *
 *  1. The renderer's session denies every web permission (`setPermissionCheckHandler(() => false)`)
 *     — correct for a window that renders untrusted source, and it makes `navigator.clipboard`
 *     reject. So the write never happened.
 *  2. `void` discards the returned promise, so the rejection went nowhere. No throw, no log, no UI.
 *
 * Either one alone would have been noticed. Together they produced a button that did nothing and
 * reported nothing. The fix addresses both: the write goes through main (which owns the clipboard
 * and needs no renderer permission, so the security posture is untouched), and the result is
 * awaited and surfaced.
 */
export async function copyToClipboard(
  text: string,
  { label = 'Copied' }: { label?: string } = {},
): Promise<boolean> {
  if (text.length === 0) {
    toast.error('Nothing to copy', 'There is no content available to copy yet.');
    return false;
  }

  const result = await invoke('system:copyToClipboard', { text });

  if (!result.ok) {
    toast.error('Could not copy', result.error.message);
    return false;
  }
  if (!result.value.copied) {
    toast.error('Nothing to copy', 'There is no content available to copy yet.');
    return false;
  }

  toast.success(label);
  return true;
}
