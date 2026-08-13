/**
 * New Project scaffold commands. Shared between main (which is the only side that ever executes
 * one — `project-service.ts`) and the renderer (which only needs the id/label/description to
 * render the picker): main must never trust a raw command string from the renderer (invariant
 * I2 — the renderer is hostile), so the renderer sends a `templateId` and main looks the real
 * command up itself, against this SAME list.
 *
 * `cmd.exe` syntax (`&&` chaining) — `project-service.ts` runs these via
 * `child_process.spawn(command, { shell: true })`, which on Windows is `cmd.exe /d /s /c
 * "<command>"`. Every command must be genuinely non-interactive: this runs headless (no terminal,
 * no PTY, nothing attached to its stdin), so a scaffolder falling back to a prompt would hang
 * forever rather than show a stuck prompt — `npx`/`npm create` are always given an explicit
 * `--yes`/non-interactive flag rather than relying on a tool's own default.
 *
 * Each scaffolds INTO `<name>` under the chosen parent directory — none of these commands `cd`
 * first, because `project-service.ts` spawns with `cwd` already set to the parent directory.
 */
export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  command: (name: string) => string;
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    // First, and therefore the default selection: starting from nothing is the one option that
    // needs no toolchain, no network and no waiting, so it is the honest default for someone who
    // does not yet know which stack they want. `mkdir` rather than a special-cased branch in
    // `project-service.ts` — it goes through the identical spawn/timeout/exit-code path as every
    // other template, so "create the folder" cannot fail in a way the other templates handle and
    // this one does not.
    id: 'blank',
    label: 'Blank Workspace',
    description: 'Empty folder — add your own files and structure',
    command: (name) => `mkdir ${name}`,
  },
  {
    id: 'react',
    label: 'React',
    description: 'Vite + React, TypeScript',
    command: (name) => `npx --yes create-vite@latest ${name} --template react-ts`,
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    description: 'App Router, TypeScript, Tailwind',
    command: (name) =>
      `npx --yes create-next-app@latest ${name} --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm`,
  },
  {
    id: 'node',
    label: 'Node',
    description: 'Minimal package.json',
    command: (name) => `mkdir ${name} && cd ${name} && npm init -y`,
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Virtualenv + requirements.txt',
    command: (name) =>
      `mkdir ${name} && cd ${name} && python -m venv .venv && type nul > requirements.txt && type nul > main.py`,
  },
  {
    id: 'vue',
    label: 'Vue',
    description: 'Vite + Vue, TypeScript',
    command: (name) => `npx --yes create-vite@latest ${name} --template vue-ts`,
  },
  {
    id: 'express',
    label: 'Express',
    description: 'express-generator, then npm install',
    command: (name) => `npx --yes express-generator ${name} --no-view && cd ${name} && npm install`,
  },
];
