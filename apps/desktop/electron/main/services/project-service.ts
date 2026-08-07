import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { PROJECT_TEMPLATES, UserFacingError } from '@fixora/shared-types';

/** Tail of combined stdout/stderr kept for the error message — enough to show what actually went
 * wrong without unbounded memory growth on a scaffolder that logs a lot. */
const OUTPUT_TAIL_BYTES = 4000;
const CREATE_TIMEOUT_MS = 10 * 60 * 1000; // scaffolders fetch packages; slow, not hung

/**
 * Runs a template's scaffold command as a plain background child process — never a terminal, never
 * a PTY, nothing attached to its stdin. That is what makes this genuinely silent (no window, no
 * xterm instance to mount) and is also why every template command must be non-interactive
 * (`project-templates.ts`'s own doc comment): a prompt here has no way to ever be answered.
 *
 * `shell: true` on Windows is `cmd.exe /d /s /c "<command>"` — a single non-interactive invocation,
 * not the persistent interactive REPL a PTY session gives you. `&&` chaining works the same way in
 * both, but the non-interactive form has none of the echo/prompt-timing fragility a PTY-typed
 * command has, which is what made the previous implementation's completion detection unreliable.
 */
export async function createProject(
  parentDir: string,
  name: string,
  templateId: string,
): Promise<string> {
  const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
  if (template === undefined) {
    throw new UserFacingError('Unknown project template.', {
      code: 'contract_violation',
      action: { type: 'none', label: 'Dismiss' },
      stage: 'workspace',
    });
  }

  const projectPath = join(parentDir, name);
  const command = template.command(name);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: parentDir,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let tail = '';
    const capture = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new UserFacingError('The scaffold command took too long and was stopped.', {
          code: 'timeout',
          action: { type: 'none', label: 'Dismiss' },
          stage: 'workspace',
        }),
      );
    }, CREATE_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new UserFacingError(`Could not start the scaffold command: ${error.message}`, {
          code: 'contract_violation',
          action: { type: 'none', label: 'Dismiss' },
          stage: 'workspace',
        }),
      );
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      // The tool's own output, verbatim — the same "show the real error" discipline the IPC
      // router uses (UserFacingError.message reaches the renderer unredacted).
      const detail = tail.trim();
      reject(
        new UserFacingError(
          `The scaffold command failed (exit code ${String(code)}).${detail === '' ? '' : `\n\n${detail}`}`,
          { code: 'contract_violation', action: { type: 'none', label: 'Dismiss' }, stage: 'workspace' },
        ),
      );
    });
  });

  return projectPath;
}
