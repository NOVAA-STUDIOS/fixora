import { CloseIcon, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { useZapprStore } from '../../stores/zappr-store.js';

/**
 * Zappr: a floating, freeform-prompt coding agent panel — an overlay inside the workbench (not
 * app-shell), so it renders above every workbench panel but below nothing else. Distinct from the
 * finding-grounded repair pipeline: the user describes what they want in prose, the model proposes
 * a plan of file creates/edits/deletes, and each step executes and reports individually.
 */
export function ZapprPanel(): React.JSX.Element | null {
  const isOpen = useZapprStore((s) => s.isOpen);
  const isRunning = useZapprStore((s) => s.isRunning);
  const prompt = useZapprStore((s) => s.prompt);
  const plan = useZapprStore((s) => s.plan);
  const steps = useZapprStore((s) => s.steps);
  const summary = useZapprStore((s) => s.summary);
  const error = useZapprStore((s) => s.error);
  const close = useZapprStore((s) => s.close);
  const setPrompt = useZapprStore((s) => s.setPrompt);
  const run = useZapprStore((s) => s.run);
  const cancel = useZapprStore((s) => s.cancel);
  const listen = useZapprStore((s) => s.listen);

  useEffect(() => listen(), [listen]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={close}
    >
      <div
        className="animate-ios-dialog-enter relative w-[600px] max-w-[90vw] rounded-2xl border border-border-subtle bg-canvas/95 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 pt-5 pb-4">
          <div className="flex size-8 items-center justify-center rounded-xl bg-accent/15">
            <span className="text-lg">⚡</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-fg">Zappr</h2>
            <p className="text-[11px] text-fg-muted">Just zap it into existence</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-lg p-1.5 text-fg-muted hover:bg-hover"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {error !== null && (
          <p role="alert" className="px-5 pt-3 text-xs text-danger-text [overflow-wrap:anywhere]">
            {error}
          </p>
        )}

        {!isRunning && plan === null && (
          <div className="px-5 py-4">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run();
              }}
              placeholder='Try "Create a login page with React" or "Add dark mode toggle"'
              className="min-h-[80px] w-full resize-none rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:border-accent"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-fg-muted">Ctrl+Enter to run</span>
              <button
                type="button"
                onClick={() => void run()}
                disabled={prompt.trim() === ''}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                ⚡ Zap
              </button>
            </div>
          </div>
        )}

        {plan !== null && (
          <div className="max-h-[300px] space-y-2 overflow-y-auto px-5 py-4">
            {summary !== null && summary !== '' && (
              <p className="mb-3 text-sm text-fg-secondary">{summary}</p>
            )}
            {steps.map(({ step, status }, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full',
                    status === 'done'
                      ? 'bg-success/20 text-success-text'
                      : status === 'running'
                        ? 'animate-pulse bg-accent/20 text-accent'
                        : status === 'error'
                          ? 'bg-danger/20 text-danger-text'
                          : 'bg-border-subtle text-fg-muted',
                  )}
                >
                  {status === 'done'
                    ? '✓'
                    : status === 'running'
                      ? '⟳'
                      : status === 'error'
                        ? '✗'
                        : String(i + 1)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-fg">{step.filePath}</p>
                  <p className="text-[11px] text-fg-muted">{step.description}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                    step.type === 'create'
                      ? 'bg-success/15 text-success-text'
                      : step.type === 'edit'
                        ? 'bg-accent/15 text-accent-text'
                        : 'bg-danger/15 text-danger-text',
                  )}
                >
                  {step.type}
                </span>
              </div>
            ))}
          </div>
        )}

        {isRunning && (
          <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
            <span className="animate-pulse text-xs text-fg-muted">Zapping...</span>
            <button
              type="button"
              onClick={() => void cancel()}
              className="text-xs text-danger-text hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
