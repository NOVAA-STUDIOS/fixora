import { Button, GitBranchIcon } from '@fixora/ui';
import { useId, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { PreCommitPanel } from './pre-commit-panel.js';
import { Group, ToggleField } from './settings-fields.js';

const WORKFLOW_PATH = '.github/workflows/fixora.yml';

type WorkflowOptions = {
  failOnErrors: boolean;
  failOnSecurity: boolean;
  runOnPullRequest: boolean;
  runOnPush: boolean;
};

/**
 * Builds the workflow YAML from the four toggles below. `fixora-cli` does not exist — no such
 * package is published anywhere — so this runs ESLint and `tsc` directly instead of pretending to
 * call a tool that would fail every job with "package not found". "Fail on security issues" has no
 * step to attach to here (neither ESLint nor `tsc` does security scanning) — the toggle stays,
 * honestly inert, rather than being wired to something it doesn't actually gate.
 */
function buildWorkflow(options: WorkflowOptions): string {
  const on: string[] = [];
  if (options.runOnPullRequest) {
    on.push('  pull_request:\n    branches: [main, master, develop]');
  }
  if (options.runOnPush) {
    on.push('  push:\n    branches: [main, master]');
  }
  const eslintFlags = options.failOnErrors ? ' --max-warnings 0' : '';

  return `name: Fixora Code Analysis
on:
${on.length > 0 ? on.join('\n') : '  workflow_dispatch: {}'}

jobs:
  fixora-analyze:
    runs-on: ubuntu-latest
    name: Code Analysis
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install --legacy-peer-deps

      - name: ESLint Analysis
        if: always()
        run: npx eslint . --ext .js,.jsx,.ts,.tsx${eslintFlags}

      - name: TypeScript Check
        if: always()
        run: npx tsc --noEmit

# Note: Full Fixora AI repair coming via fixora-cli (coming soon)
`;
}

/**
 * GitHub Actions export (Settings > Integrations). Writes a workflow file into the open workspace
 * so Fixora's analysis runs in CI on every PR — a generated artifact the user commits themselves,
 * not something Fixora pushes on their behalf.
 */
export function GitHubActionsPanel(): React.JSX.Element | null {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [options, setOptions] = useState<WorkflowOptions>({
    failOnErrors: true,
    failOnSecurity: true,
    runOnPullRequest: true,
    runOnPush: true,
  });
  const [writtenPath, setWrittenPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failOnErrorsId = useId();
  const failOnSecurityId = useId();
  const runOnPrId = useId();
  const runOnPushId = useId();

  // Only meaningful with a workspace open — there is nowhere to write the file otherwise.
  if (workspace === null) return null;

  const workflow = buildWorkflow(options);

  const generate = async (): Promise<void> => {
    setError(null);
    const result = await invoke('fs:writeWorkspaceFile', {
      relPath: WORKFLOW_PATH,
      content: workflow,
    });
    if (result.ok) {
      setWrittenPath(result.value.absolutePath);
    } else {
      setError(result.error.message);
      setWrittenPath(null);
    }
  };

  return (
    <Group title="Integrations">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="size-4 text-fg-muted" />
        <div>
          <p className="text-sm font-medium text-fg">GitHub Actions</p>
          <p className="text-xs text-fg-muted">Auto-analyze code on every PR.</p>
        </div>
      </div>

      <ToggleField
        label="Fail on errors"
        htmlFor={failOnErrorsId}
        description="The CI job exits non-zero if analysis finds any error-severity finding."
        checked={options.failOnErrors}
        onCheckedChange={(failOnErrors) => {
          setOptions((o) => ({ ...o, failOnErrors }));
        }}
      />
      <ToggleField
        label="Fail on security issues"
        htmlFor={failOnSecurityId}
        description="The CI job exits non-zero if analysis finds any security-category finding."
        checked={options.failOnSecurity}
        onCheckedChange={(failOnSecurity) => {
          setOptions((o) => ({ ...o, failOnSecurity }));
        }}
      />
      <ToggleField
        label="Run on pull requests"
        htmlFor={runOnPrId}
        description="Triggers on PRs targeting main, master, or develop."
        checked={options.runOnPullRequest}
        onCheckedChange={(runOnPullRequest) => {
          setOptions((o) => ({ ...o, runOnPullRequest }));
        }}
      />
      <ToggleField
        label="Run on push to main"
        htmlFor={runOnPushId}
        description="Triggers on pushes directly to main or master."
        checked={options.runOnPush}
        onCheckedChange={(runOnPush) => {
          setOptions((o) => ({ ...o, runOnPush }));
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            void generate();
          }}
        >
          Generate workflow file
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyToClipboard(workflow, { label: 'Workflow YAML copied' })}
        >
          Copy to clipboard
        </Button>
      </div>

      {writtenPath !== null && (
        <p className="text-xs text-success-text [overflow-wrap:anywhere]">
          Written to {writtenPath}
        </p>
      )}
      {error !== null && <p className="text-xs text-danger-text">{error}</p>}

      <div className="border-t border-border-subtle pt-4">
        <PreCommitPanel />
      </div>
    </Group>
  );
}
