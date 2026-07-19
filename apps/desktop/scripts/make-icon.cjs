// Generates build/icon.png — the application icon for the packaged app and installer.
//
// Without this file electron-builder falls back to the default Electron icon, which is what
// v0.9.0-beta.1 shipped: a generic binary asking to be installed from an unsigned download page.
//
// The mark is not redrawn here. It is the same geometry as `FixoraMark` in @fixora/ui, kept in one
// place below so the icon and the in-app logo cannot drift apart silently — if you change the mark,
// change it here and re-run `pnpm icon`.
//
// Rasterizing needs a renderer, and Electron already is one. So this boots a hidden offscreen window,
// paints the SVG at 512x512 on a transparent ground, and captures it. That avoids adding an image
// toolchain (sharp, ImageMagick) to a project in release freeze for a file that changes once a year.
// electron-builder converts the PNG to the .ico Windows needs, so no ICO encoder is required either.
//
// CommonJS on purpose. Electron injects its API into the CJS loader; handed an .mjs entry it runs the
// file through Node's ESM loader without doing so, and `electron`'s bindings come back undefined.
// This is the same constraint that keeps the preload CJS (see the note in package.json).
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const { BrowserWindow, app, nativeImage } = require('electron');

// `ELECTRON_RUN_AS_NODE=1` in the environment makes the electron binary behave as plain Node, so the
// GUI bindings are absent and `app` is undefined. Some editors and CI runners set it globally. Rather
// than depend on a clean environment — or add cross-env to a project in release freeze — relaunch
// ourselves once with the variable removed. `restarted` stops that becoming a fork bomb if the
// bindings are missing for some other reason.
if (app === undefined) {
  if (process.env.FIXORA_ICON_RELAUNCHED === '1') {
    console.error('make-icon: electron has no GUI bindings even after relaunch — icon NOT written.');
    process.exit(1);
  }
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, FIXORA_ICON_RELAUNCHED: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, [__filename], { env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const SIZE = 512; // electron-builder needs >=256 to produce a full .ico; 512 leaves headroom.
const outDir = join(__dirname, '..', 'build');
const outFile = join(outDir, 'icon.png');

/** The FixoraMark artwork, viewBox 0 0 48 48. Keep in sync with packages/ui/src/components/icons.tsx. */
const MARK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${SIZE}" height="${SIZE}" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="12" fill="url(#g)"/>
  <path d="M17.5 15.5 11 24l6.5 8.5M30.5 15.5 37 24l-6.5 8.5" stroke="#ffffff" stroke-opacity="0.55"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m20 24.5 3 3 5.5-6.5" stroke="#ffffff" stroke-width="2.75"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;width:${SIZE}px;height:${SIZE}px;overflow:hidden}</style>
${MARK_SVG}`;

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true, // the mark has rounded corners; a white ground would show as square shoulders
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  // A data: URL rather than a temp file, so nothing is left behind if this crashes midway.
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);

  const image = await win.webContents.capturePage();
  if (image.isEmpty()) {
    console.error('make-icon: captured an empty frame — the icon was NOT written.');
    return 1;
  }

  const { width, height } = image.getSize();
  if (width !== SIZE || height !== SIZE) {
    // Guard against a machine whose display scaling silently changes the capture size: a 640px icon
    // would still "work" and would still look wrong.
    console.error(`make-icon: expected ${SIZE}x${SIZE}, captured ${width}x${height} — not written.`);
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, nativeImage.createFromBuffer(image.toPNG()).toPNG());
  console.log(`make-icon: wrote ${outFile} (${width}x${height})`);
  return 0;
}

main().then(
  (code) => app.exit(code),
  (error) => {
    console.error('make-icon failed:', error);
    app.exit(1);
  },
);
