import { Button, GitBranchIcon, cn } from '@fixora/ui';
import { useEffect, useId, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { ToggleField } from './settings-fields.js';

type HookOptions = {
  blockOnErrors: boolean;
  blockOnSecurity: boolean;
  stagedOnly: boolean;
};

/**
 * Pre-commit Hooks (Settings > Integrations, below GitHub Actions). Installs a `.git/hooks/pre-commit`
 * script that runs ESLint before a commit is allowed — local, no CI round trip needed to catch a
 * problem GitHub Actions would otherwise catch minutes later.
 */
export function PreCommitPanel(): React.JSX.Element | null {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [options, setOptions] = useState<HookOptions>({
    blockOnErrors: true,
    blockOnSecurity: true,
    stagedOnly: false,
  });
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blockErrorsId = useId();
  const blockSecurityId = useId();
  const stagedOnlyId = useId();

  // Status is asked for fresh on every workspace switch — a hook installed in one project says
  // nothing about another, so the last-known state must not carry over from the previous folder.
  useEffect(() => {
    if (workspace === null) {
      setInstalled(null);
      return;
    }
    let cancelled = false;
    void invoke('hook:status', {}).then((result) => {
      if (!cancelled && result.ok) setInstalled(result.value.installed);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  if (workspace === null) return null;

  const install = async (): Promise<void> => {
    setError(null);
    const result = await invoke('hook:install', options);
    if (result.ok) {
      setInstalled(result.value.installed);
      if (!result.value.installed) setError('This project has no .git folder to install a hook into.');
    } else {
      setError(result.error.message);
    }
  };

  const remove = async (): Promise<void> => {
    setError(null);
    const result = await invoke('hook:remove', {});
    if (result.ok) setInstalled(false);
    else setError(result.error.message);
  };

  // No `Group` wrapper: it always renders a heading, and this card belongs directly under
  // `GitHubActionsPanel`'s "Integrations" heading in settings-panel.tsx, not a second one.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 text-fg-muted" />
        <div>
          <p className="text-sm font-medium text-fg">Pre-commit Hooks</p>
          <p className="text-xs text-fg-muted">Block commits with errors.</p>
        </div>
      </div>

      <ToggleField
        label="Block on errors"
        htmlFor={blockErrorsId}
        description="The commit is refused if ESLint finds any error-severity problem in the changed files."
        checked={options.blockOnErrors}
        onCheckedChange={(blockOnErrors) => {
          setOptions((o) => ({ ...o, blockOnErrors }));
        }}
      />
      <ToggleField
        label="Block on security issues"
        htmlFor={blockSecurityId}
        description="Reserved for a future security-focused check — ESLint alone does not scan for these."
        checked={options.blockOnSecurity}
        onCheckedChange={(blockOnSecurity) => {
          setOptions((o) => ({ ...o, blockOnSecurity }));
        }}
      />
      <ToggleField
        label="Run only on staged files"
        htmlFor={stagedOnlyId}
        description="Lints only the files in this commit, not the whole project — faster on a large repo."
        checked={options.stagedOnly}
        onCheckedChange={(stagedOnly) => {
          setOptions((o) => ({ ...o, stagedOnly }));
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={installed === true}
          onClick={() => {
            void install();
          }}
        >
          Install pre-commit hook
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={installed !== true}
          onClick={() => {
            void remove();
          }}
        >
          Remove hook
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        Status:
        <span
          aria-hidden="true"
          className={cn('inline-block size-1.5 rounded-full', installed === true ? 'bg-success-text' : 'bg-border-strong')}
        />
        {installed === null ? 'Checking…' : installed ? 'Installed' : 'Not installed'}
      </p>
      {error !== null && <p className="text-xs text-danger-text">{error}</p>}
    </div>
  );
}
