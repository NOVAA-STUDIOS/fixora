/** A shell-free scaffold operation interpreted only by Electron main. */
export type ProjectScaffoldStep =
  | { type: 'command'; executable: string; args: readonly string[]; cwd: 'parent' | 'project' }
  | { type: 'mkdir' }
  | { type: 'touch'; files: readonly string[] };

export type ProjectTemplate = {
  id: string;
  label: string;
  description: string;
  steps: (name: string) => readonly ProjectScaffoldStep[];
};

/** One conservative cross-platform filename segment, never a path or shell command. */
export const PROJECT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_PATTERN.test(name) && !name.includes('..');
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'blank',
    label: 'Blank Workspace',
    description: 'Empty folder — add your own files and structure',
    steps: () => [{ type: 'mkdir' }],
  },
  {
    id: 'react',
    label: 'React',
    description: 'Vite + React, TypeScript',
    steps: (name) => [{ type: 'command', executable: 'npx', args: ['--yes', 'create-vite@latest', name, '--template', 'react-ts'], cwd: 'parent' }],
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    description: 'App Router, TypeScript, Tailwind',
    steps: (name) => [{
      type: 'command',
      executable: 'npx',
      args: ['--yes', 'create-next-app@latest', name, '--typescript', '--tailwind', '--eslint', '--app', '--no-src-dir', '--import-alias', '@/*', '--use-npm'],
      cwd: 'parent',
    }],
  },
  {
    id: 'node',
    label: 'Node',
    description: 'Minimal package.json',
    steps: () => [
      { type: 'mkdir' },
      { type: 'command', executable: 'npm', args: ['init', '-y'], cwd: 'project' },
    ],
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Virtualenv + requirements.txt',
    steps: () => [
      { type: 'mkdir' },
      { type: 'command', executable: 'python', args: ['-m', 'venv', '.venv'], cwd: 'project' },
      { type: 'touch', files: ['requirements.txt', 'main.py'] },
    ],
  },
  {
    id: 'vue',
    label: 'Vue',
    description: 'Vite + Vue, TypeScript',
    steps: (name) => [{ type: 'command', executable: 'npx', args: ['--yes', 'create-vite@latest', name, '--template', 'vue-ts'], cwd: 'parent' }],
  },
  {
    id: 'express',
    label: 'Express',
    description: 'express-generator, then npm install',
    steps: (name) => [
      { type: 'command', executable: 'npx', args: ['--yes', 'express-generator', name, '--no-view'], cwd: 'parent' },
      { type: 'command', executable: 'npm', args: ['install'], cwd: 'project' },
    ],
  },
];
