import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ShellOption = { id: string; label: string; command: string; args: string[] };

/**
 * Every shell this machine actually has, detected by checking well-known install paths — never
 * assumed. `cmd.exe` and PowerShell ship with every Windows install; Git Bash and WSL are optional
 * and only offered when genuinely present, the same "no false capability" discipline
 * `resolveFormatter` (core-analysis) already follows for Prettier/Ruff.
 */
export function detectShells(): ShellOption[] {
  if (process.platform !== 'win32') {
    const shell = process.env['SHELL'] ?? 'bash';
    return [{ id: 'default', label: shell.split(/[\\/]/).pop() ?? shell, command: shell, args: [] }];
  }

  const shells: ShellOption[] = [
    { id: 'powershell', label: 'PowerShell', command: 'powershell.exe', args: [] },
    { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', args: [] },
  ];

  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const gitBash = join(programFiles, 'Git', 'bin', 'bash.exe');
  if (existsSync(gitBash)) {
    shells.push({ id: 'git-bash', label: 'Git Bash', command: gitBash, args: [] });
  }

  const wsl = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (existsSync(wsl)) {
    shells.push({ id: 'wsl', label: 'WSL Bash', command: wsl, args: [] });
  }

  return shells;
}

export function shellById(id: string | undefined): ShellOption {
  const shells = detectShells();
  return shells.find((s) => s.id === id) ?? shells[0] ?? { id: 'cmd', label: 'Command Prompt', command: 'cmd.exe', args: [] };
}
