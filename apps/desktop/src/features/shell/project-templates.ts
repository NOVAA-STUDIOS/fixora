/**
 * New Project scaffold commands. `cmd.exe` syntax (`&&` chaining) — the integrated terminal always
 * spawns `cmd.exe` on Windows (`terminal-service.ts`'s `shellFor()`), so this targets that shell
 * rather than trying to be POSIX-portable for a feature that only ever runs inside it.
 *
 * Each scaffolds INTO `<name>` under the chosen parent directory — none of these commands `cd`
 * first, because the scratch terminal is already rooted there (`terminal:createScratch`).
 */
export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  command: (name: string) => string;
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'react',
    label: 'React',
    description: 'Vite + React, TypeScript',
    command: (name) => `npm create vite@latest ${name} -- --template react-ts`,
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
    command: (name) => `npm create vite@latest ${name} -- --template vue-ts`,
  },
  {
    id: 'express',
    label: 'Express',
    description: 'express-generator, then npm install',
    command: (name) => `npx --yes express-generator ${name} --no-view && cd ${name} && npm install`,
  },
];
