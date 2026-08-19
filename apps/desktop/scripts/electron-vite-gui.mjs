// Run electron-vite with a GUI Electron, never a headless Node.
//
// Some shells and tooling export `ELECTRON_RUN_AS_NODE=1` so that Node-based scripts can run through
// an Electron binary. If that variable leaks into `pnpm dev`/`preview`, the Electron we launch boots
// as **plain Node.js**: `app`, `BrowserWindow` and the rest of the GUI API are `undefined`, and the
// main process throws on the first `app.*` call before any window paints — which the user sees as a
// black (or instantly-gone) window. We own the launch, so we strip the variable here rather than
// trust every shell on every machine to be clean. Cross-platform: no `.cmd` clearing, no `cross-env`.
import { spawn } from 'node:child_process';

delete process.env.ELECTRON_RUN_AS_NODE;

const mode = process.argv[2] ?? 'dev';
// `--` forwards everything after it to the Electron process electron-vite spawns (its own
// documented passthrough) — `--inspect=9229` opens the main process's V8 inspector so it can be
// attached to (chrome://inspect, or `node --inspect`-compatible tooling) independently of the
// renderer's own DevTools, which is what's needed when the renderer itself is the thing hung.
const child = spawn('electron-vite', [mode, '--', '--inspect=9229'], {
  stdio: 'inherit',
  // `shell: true` so the local `node_modules/.bin/electron-vite` shim resolves on every OS; pnpm puts
  // that directory on PATH while a script runs. The child inherits our now-cleaned env, and so does
  // the Electron process electron-vite spawns.
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
