import { CloseIcon, cn } from '@fixora/ui';
import { useEffect, useRef } from 'react';

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

  const panelRef = useRef<HTMLDivElement>(null);

  // Direct DOM manipulation — no React re-renders during drag.
  function handleHeaderMouseDown(e: React.MouseEvent): void {
    const panel = panelRef.current;
    if (panel === null) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const style = window.getComputedStyle(panel);
    const matrix = new DOMMatrix(style.transform);
    const startTransX = matrix.m41;
    const startTransY = matrix.m42;

    const onMove = (moveEvent: MouseEvent): void => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      panel.style.transform = `translate(${String(startTransX + dx)}px, ${String(startTransY + dy)}px)`;
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        ref={panelRef}
        className="animate-ios-dialog-enter relative w-[680px] max-w-[90vw]"
        style={{
          borderRadius: '20px',
          background: 'linear-gradient(135deg, #7c3aed, #06b6d4, #7c3aed)',
          padding: '1px',
          boxShadow:
            '0 0 0 1px rgba(124,58,237,0.3), 0 0 40px rgba(124,58,237,0.15), 0 0 80px rgba(6,182,212,0.1)',
        }}
      >
        <div className="overflow-hidden rounded-[19px] bg-[#0d0d0d]">
          <div
            onMouseDown={handleHeaderMouseDown}
            className="flex cursor-grab items-center gap-3 border-b border-border-subtle px-5 pt-5 pb-4 select-none active:cursor-grabbing"
          >
            <div className="flex size-8 animate-pulse items-center justify-center rounded-xl bg-accent/15">
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
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim() !== '') void run();
                }
                // Shift+Enter = new line (default textarea behavior)
              }}
              placeholder='Try "Create a login page with React" or "Add dark mode toggle"'
              className="max-h-[200px] min-h-[100px] w-full resize-none rounded-xl bg-[#1a1a1a] p-4 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:shadow-[0_0_20px_rgba(124,58,237,0.15)] focus:ring-2 focus:ring-accent/40"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-fg-muted">Enter to run · Shift+Enter for new line</span>
              <button
                type="button"
                onClick={() => void run()}
                disabled={prompt.trim() === ''}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-40"
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
    </div>
  );
}
