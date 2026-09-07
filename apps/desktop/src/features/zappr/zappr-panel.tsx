import { CloseIcon, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import zapprMascot from '../../assets/zappr-mascot.png';
import { useZapprStore } from '../../stores/zappr-store.js';

/** Tailwind classes, not inline CSS vars — this file styles everything through the design-token
 *  utility classes (text-fg, bg-hover, etc.), not raw `var(--...)` references. */
const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="my-2 text-[15px] font-semibold text-fg">{children}</h1>,
  h2: ({ children }) => <h2 className="my-2 text-[14px] font-semibold text-fg">{children}</h2>,
  h3: ({ children }) => <h3 className="my-1.5 text-[13px] font-semibold text-fg">{children}</h3>,
  p: ({ children }) => <p className="my-1.5 leading-[1.7] text-fg">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  code: ({ className, children }) =>
    className?.includes('language-') === true ? (
      <pre
        className="my-2 overflow-x-auto rounded-lg bg-[#1a1a1a] p-3 font-mono text-[13px]"
        style={{ overflowX: 'auto', maxWidth: '100%', wordBreak: 'break-word' }}
      >
        <code>{children}</code>
      </pre>
    ) : (
      <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[13px] text-accent">{children}</code>
    ),
  ul: ({ children }) => <ul className="my-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5 leading-[1.6] text-fg">{children}</li>,
  hr: () => <hr className="my-3 border-t border-border-subtle" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-fg-muted">{children}</blockquote>
  ),
};

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
  const mode = useZapprStore((s) => s.mode);
  const chatResponse = useZapprStore((s) => s.chatResponse);
  const streamingText = useZapprStore((s) => s.streamingText);
  const currentFilePath = useZapprStore((s) => s.currentFilePath);
  const currentFileContent = useZapprStore((s) => s.currentFileContent);
  const lastTerminalCommand = useZapprStore((s) => s.lastTerminalCommand);
  const lastKeyUpdateProvider = useZapprStore((s) => s.lastKeyUpdateProvider);
  const lastShortcutCreated = useZapprStore((s) => s.lastShortcutCreated);
  const close = useZapprStore((s) => s.close);
  const setPrompt = useZapprStore((s) => s.setPrompt);
  const clearError = useZapprStore((s) => s.clearError);
  const run = useZapprStore((s) => s.run);
  const cancel = useZapprStore((s) => s.cancel);
  const listen = useZapprStore((s) => s.listen);
  const [copied, setCopied] = useState(false);

  useEffect(() => listen(), [listen]);

  useEffect(() => {
    console.warn('[Zappr:UI] State →', mode, isRunning ? 'running' : 'idle');
  }, [mode, isRunning]);

  const panelRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = responseRef.current;
    if (el === null) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isRunning || isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingText, chatResponse, isRunning]);

  useEffect(() => {
    if (isRunning && responseRef.current !== null) {
      responseRef.current.scrollTop = 0;
    }
  }, [isRunning]);

  // Mouse drag was unreliable with GPU compositing disabled — Alt+Arrow keys move the panel
  // instead, in fixed steps, always starting from screen center.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (panel === null) return;

    const STEP = 20;
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey) return;
      const style = window.getComputedStyle(panel);
      const matrix = new DOMMatrix(style.transform);
      let x = matrix.m41;
      let y = matrix.m42;

      if (e.key === 'ArrowLeft') x -= STEP;
      if (e.key === 'ArrowRight') x += STEP;
      if (e.key === 'ArrowUp') y -= STEP;
      if (e.key === 'ArrowDown') y += STEP;

      panel.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Direct DOM manipulation — no React re-renders during drag.
  function handleHeaderMouseDown(e: React.MouseEvent): void {
    e.preventDefault();
    const panel = panelRef.current;
    if (panel === null) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const matrix = new DOMMatrix(window.getComputedStyle(panel).transform);
    const startTransX = matrix.m41;
    const startTransY = matrix.m42;

    const onMove = (ev: MouseEvent): void => {
      panel.style.transform = `translate(${String(startTransX + ev.clientX - startX)}px, ${String(startTransY + ev.clientY - startY)}px)`;
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function fallbackCopy(text: string): void {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- only reliable fallback when the async Clipboard API is unavailable
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  async function copyToClipboard(text: string): Promise<void> {
    if (window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopy(text);
      }
    } else {
      fallbackCopy(text);
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  if (!isOpen) return null;

  return (
      <div
        ref={panelRef}
        className="zappr-rgb animate-ios-dialog-enter absolute right-6 bottom-16 z-50 w-[360px] max-w-[90vw] overflow-y-auto max-h-[85vh] flex flex-col"
        style={{
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #7c3aed, #06b6d4, #7c3aed)',
          padding: '1px',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          className="overflow-hidden rounded-[13px] bg-[#0d0d0d]"
          style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        >
          <div
            onMouseDown={handleHeaderMouseDown}
            className="flex cursor-grab items-center gap-3 border-b border-border-subtle px-3 pt-3 pb-2.5 select-none active:cursor-grabbing"
          >
            <div className="relative size-10 shrink-0">
              <img
                src={zapprMascot}
                alt="Zappr"
                className={cn(
                  'size-10 object-contain transition-transform',
                  isRunning ? 'animate-zappr-run' : 'animate-zappr-idle',
                )}
              />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-fg">Zappr</h2>
              <p className="text-[10px] text-fg-muted">
                {isRunning ? 'Zapping...' : 'just zap it into existence'}
              </p>
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
          <div role="alert" className="px-3 py-2.5 text-xs text-danger-text bg-danger/10 rounded-lg mx-3 mb-3">
            ⚡ {error}
            <button
              type="button"
              onClick={() => {
                clearError();
                setPrompt('');
              }}
              className="ml-2 underline"
            >
              Try again
            </button>
          </div>
        )}

        {!isRunning && plan === null && (
          <div className="px-3 py-2.5">
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
              className="max-h-[150px] min-h-[60px] w-full resize-none rounded-xl bg-[#1a1a1a] p-4 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:shadow-[0_0_20px_rgba(124,58,237,0.15)] focus:ring-2 focus:ring-accent/40"
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
          <div className="max-h-[300px] space-y-2 overflow-y-auto px-3 py-2.5">
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

          {lastTerminalCommand !== null && (
            <div className="mx-3 mb-3 rounded-lg border border-white/10 px-3 py-2" style={{ background: 'color-mix(in srgb, black 60%, transparent)' }}>
              <p className="font-mono text-[11px] text-green-400">$ {lastTerminalCommand}</p>
              {chatResponse !== null && (
                <p className="mt-1 text-[11px] text-fg-muted">{chatResponse}</p>
              )}
              {chatResponse !== null && !chatResponse.startsWith('Terminal not open') && (
                <p className="mt-1 text-[10px] text-fg-muted">→ Sent to terminal</p>
              )}
            </div>
          )}

          {lastKeyUpdateProvider !== null && (
            <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2">
              <span className="text-sm">🔑</span>
              <div>
                <p className="text-[11px] font-medium text-success-text">API key saved</p>
                <p className="text-[10px] text-fg-muted">Provider: {lastKeyUpdateProvider}</p>
              </div>
            </div>
          )}

          {lastShortcutCreated !== null && (
            <div
              className={cn(
                'mx-3 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2',
                lastShortcutCreated.unresolved
                  ? 'border-warn/30 bg-warn/10'
                  : 'border-success/30 bg-success/10',
              )}
            >
              <span className="text-sm">⌨</span>
              <div>
                <p className={cn('font-mono text-[11px] font-medium', lastShortcutCreated.unresolved ? 'text-warn-text' : 'text-success-text')}>
                  [{lastShortcutCreated.keys}]
                </p>
                <p className="text-[10px] text-fg-muted">→ {lastShortcutCreated.description}</p>
              </div>
            </div>
          )}

          {(streamingText !== '' || chatResponse !== null) && lastTerminalCommand === null && lastKeyUpdateProvider === null && lastShortcutCreated === null && (
          <div className="mx-3 mb-3 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
              <img src={zapprMascot} alt="" className="size-5 object-contain" />
              <span className="text-[11px] font-semibold text-accent">Zappr</span>
              <span className="ml-1 text-[10px] text-fg-muted">
                {mode === 'math'
                  ? '· Math solver'
                  : mode === 'file'
                    ? '· Code agent'
                    : mode === 'repair'
                      ? '· Debug mode'
                      : '· Assistant'}
              </span>
              {isRunning && (
                <span className="ml-auto text-[10px] text-fg-muted">
                  <span className="animate-pulse">●</span> thinking...
                </span>
              )}
            </div>

            <div
              ref={responseRef}
              className="min-h-[300px] max-h-[450px] overflow-y-auto px-3 py-2.5 text-[12.5px] tracking-[0.01em]"
              style={{ overflowX: 'hidden', overflowY: 'auto' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {streamingText !== '' ? streamingText : chatResponse}
              </ReactMarkdown>
            </div>

            {chatResponse !== null && !isRunning && (
              <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3 py-2">
                <button
                  type="button"
                  onClick={() => void copyToClipboard(chatResponse)}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    copied ? 'bg-success/15 text-success-text' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            )}
          </div>
        )}

        {!isRunning && (steps.length > 0 || chatResponse !== null) && (
          <div className="shrink-0 border-t border-white/10 px-3 pt-2 pb-3">
            <button
              type="button"
              onClick={() => {
                clearError();
                setPrompt('');
                useZapprStore.setState({
                  steps: [],
                  plan: null,
                  chatResponse: null,
                  streamingText: '',
                  summary: null,
                  currentStep: 0,
                  mode: null,
                  currentFilePath: null,
                  currentFileContent: null,
                  lastTerminalCommand: null,
                  lastKeyUpdateProvider: null,
                  lastShortcutCreated: null,
                });
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs font-medium text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
            >
              ⚡ New Zap
            </button>
          </div>
        )}

        {currentFilePath !== null && (
          <div className="border-t border-white/10 px-3 py-2">
            <p className="mb-1 font-mono text-[10px] text-fg-muted">Writing: {currentFilePath}</p>
            <div className="relative max-h-[200px] overflow-hidden rounded-lg bg-[#1a1a1a] p-2">
              <pre className="animate-pulse overflow-hidden font-mono text-[11px] leading-relaxed text-green-400">
                {currentFileContent?.slice(0, 500)}
                {(currentFileContent?.length ?? 0) > 500 ? '...' : ''}
              </pre>
              <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-green-400" />
            </div>
          </div>
        )}

        {isRunning && (
            <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2.5">
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
