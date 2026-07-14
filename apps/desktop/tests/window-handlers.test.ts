import { describe, expect, it, vi, beforeEach } from 'vitest';

// The router imports ipcMain and BrowserWindow; a light stub is enough for registration.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

type Handler = (req: unknown, ctx: { requestId: string; window: FakeWindow | null }) => unknown;

/** A minimal stand-in for the bits of BrowserWindow the handlers touch. */
class FakeWindow {
  maximized = false;
  minimizeCount = 0;
  closeCount = 0;
  minimize(): void {
    this.minimizeCount += 1;
  }
  maximize(): void {
    this.maximized = true;
  }
  unmaximize(): void {
    this.maximized = false;
  }
  close(): void {
    this.closeCount += 1;
  }
  isMaximized(): boolean {
    return this.maximized;
  }
}

async function freshHandlers() {
  vi.resetModules();
  const { registerHandler, getHandler } = await import('../electron/main/ipc/router.js');
  const { registerWindowHandlers } =
    await import('../electron/main/ipc/handlers/window.handlers.js');
  registerWindowHandlers();
  void registerHandler;
  return getHandler;
}

/**
 * The window-control handlers act on the caller's window and report the resulting state, so the
 * title-bar button can update its maximise/restore icon without a second round-trip. A frameless
 * window is only as good as these being correct.
 */
describe('window handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggleMaximize maximizes, then restores, reporting the new state each time', async () => {
    const getHandler = await freshHandlers();
    const toggle = getHandler('window:toggleMaximize') as Handler;
    const win = new FakeWindow();

    expect(toggle({}, { requestId: 'r', window: win })).toEqual({ isMaximized: true });
    expect(win.maximized).toBe(true);
    expect(toggle({}, { requestId: 'r', window: win })).toEqual({ isMaximized: false });
    expect(win.maximized).toBe(false);
  });

  it('minimize minimizes the caller window', async () => {
    const getHandler = await freshHandlers();
    const minimize = getHandler('window:minimize') as Handler;
    const win = new FakeWindow();
    minimize({}, { requestId: 'r', window: win });
    expect(win.minimizeCount).toBe(1);
  });

  it('close closes the caller window', async () => {
    const getHandler = await freshHandlers();
    const close = getHandler('window:close') as Handler;
    const win = new FakeWindow();
    close({}, { requestId: 'r', window: win });
    expect(win.closeCount).toBe(1);
  });

  it('tolerates a null window (call arrived with no resolvable window)', async () => {
    const getHandler = await freshHandlers();
    const isMax = getHandler('window:isMaximized') as Handler;
    expect(isMax({}, { requestId: 'r', window: null })).toEqual({ isMaximized: false });
  });
});
