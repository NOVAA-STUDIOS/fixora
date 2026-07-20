import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the Copy bug.
 *
 * The bug had two causes that were individually survivable and jointly silent:
 *
 *   1. The renderer session denies every web permission — `setPermissionCheckHandler(() => false)`
 *      in navigation-guard.ts. That is the correct posture for a window rendering untrusted source,
 *      and it makes `navigator.clipboard.writeText()` reject.
 *   2. Every call site was `void navigator.clipboard.writeText(text)`. `void` discards the promise,
 *      so the rejection reached nothing — no throw, no console, no UI.
 *
 * A button that cannot fail visibly cannot be observed to be broken. So the tests below pin both
 * halves of the fix: the write goes through main (no renderer permission involved, so the security
 * posture is untouched), and *every* outcome produces user-visible feedback.
 */

const invoke = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/bridge.js', () => ({ invoke }));
vi.mock('../src/stores/toast-store.js', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const { copyToClipboard } = await import('../src/lib/clipboard.js');

describe('copyToClipboard', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('routes through main rather than navigator.clipboard', async () => {
    // The heart of the fix. If someone "simplifies" this back to navigator.clipboard, the renderer
    // permission denial silently returns — so assert the channel explicitly.
    invoke.mockResolvedValue({ ok: true, value: { copied: true } });
    await copyToClipboard('const a = 1;');
    expect(invoke).toHaveBeenCalledWith('system:copyToClipboard', { text: 'const a = 1;' });
  });

  it('copies a repair and confirms it', async () => {
    invoke.mockResolvedValue({ ok: true, value: { copied: true } });
    await expect(copyToClipboard('repaired();', { label: 'Repair copied' })).resolves.toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith('Repair copied');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports failure instead of failing silently', async () => {
    // The original bug's exact shape: the write does not happen. It must be impossible for that to
    // pass without the user being told.
    invoke.mockResolvedValue({ ok: false, error: { message: 'Clipboard unavailable.' } });
    await expect(copyToClipboard('x')).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith('Could not copy', 'Clipboard unavailable.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('refuses to copy nothing, and never clears the clipboard doing so', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'Nothing to copy',
      'There is no content available to copy yet.',
    );
  });

  it('reports when main declines the write', async () => {
    invoke.mockResolvedValue({ ok: true, value: { copied: false } });
    await expect(copyToClipboard('x')).resolves.toBe(false);
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  /**
   * Severity parity for Copy. Copy has never had access to a finding's severity — it receives a
   * string — but the user reported it as severity-dependent, so the invariant is worth pinning:
   * identical content copies identically no matter which finding produced it.
   */
  it('behaves identically for repairs from error, warning and info findings', async () => {
    invoke.mockResolvedValue({ ok: true, value: { copied: true } });
    const code = 'useEffect(() => {}, [start]);';
    for (const severity of ['error', 'warning', 'info']) {
      invoke.mockClear();
      toastSuccess.mockClear();
      await expect(copyToClipboard(code, { label: `${severity} copied` })).resolves.toBe(true);
      expect(invoke).toHaveBeenCalledWith('system:copyToClipboard', { text: code });
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    }
  });
});
