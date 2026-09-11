import { CloseIcon, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import zapprMascot from '../../assets/zappr-mascot.png';
import { useZapprStore } from '../../stores/zappr-store.js';
import { useEditorStore } from '../editor/editor-store.js';

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
export function ZapprPanel({ sidebar = false }: { sidebar?: boolean } = {}): React.JSX.Element | null {
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
  const selectedCode = useZapprStore((s) => s.selectedCode);
  const selectedCodeFile = useZapprStore((s) => s.selectedCodeFile);
  const close = useZapprStore((s) => s.close);
  const setPrompt = useZapprStore((s) => s.setPrompt);
  const clearError = useZapprStore((s) => s.clearError);
  const run = useZapprStore((s) => s.run);
  const cancel = useZapprStore((s) => s.cancel);
  const listen = useZapprStore((s) => s.listen);
  const messages = useZapprStore((s) => s.messages);
  const clearMessages = useZapprStore((s) => s.clearMessages);
  const [copied, setCopied] = useState(false);
  const activeFile = useEditorStore((s) => s.activeTab);

  useEffect(() => listen(), [listen]);

  // Temporarily disabled — selection polling was interfering with panel state.
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     const text = activeSelectionText();
  //     const file = useEditorStore.getState().activeTab;
  //     const current = useZapprStore.getState();
  //     if (current.selectedCode === text && current.selectedCodeFile === (text ? file : null)) return;
  //     useZapprStore.setState({
  //       selectedCode: text,
  //       selectedCodeFile: text ? file : null,
  //     });
  //   }, 500);
  //   return () => {
  //     clearInterval(interval);
  //   };
  // }, []);

  useEffect(() => {
    console.warn('[Zappr:UI] State →', mode, isRunning ? 'running' : 'idle');
  }, [mode, isRunning]);

  const panelRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && responseRef.current !== null) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [streamingText, chatResponse, isRunning]);

  useEffect(() => {
    if (isRunning && responseRef.current !== null) {
      responseRef.current.scrollTop = 0;
    }
  }, [isRunning]);

  // Mouse drag was unreliable with GPU compositing disabled — Alt+Arrow keys move the panel
  // instead, in fixed steps, always starting from screen center. Dragging/repositioning makes no
  // sense for the docked sidebar embedding, so this is floating-only.
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (sidebar) return;

    const STEP = 20;
    const onKey = (e: KeyboardEvent): void => {
      if (!isOpenRef.current) return;
      if (!e.altKey) return;
      const panel = panelRef.current;
      if (panel === null) return;
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
  }, [sidebar]);

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

  if (!sidebar && !isOpen) return null;

  return (
      <div
        ref={panelRef}
        className={
          sidebar
            ? 'flex h-full w-full flex-col overflow-hidden bg-raised'
            : 'zappr-rgb animate-ios-dialog-enter absolute right-4 bottom-4 z-50 w-[360px] max-w-[90vw] flex flex-col'
        }
        style={
          sidebar
            ? undefined
            : {
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #7c3aed, #06b6d4, #7c3aed)',
                padding: '1px',
                maxHeight: 'calc(100vh - 80px)',
              }
        }
      >
        <div
          className={cn('flex flex-1 flex-col', sidebar ? 'bg-raised' : 'bg-[#0d0d0d] rounded-[13px]')}
          style={
            sidebar
              ? undefined
              : {
                  borderTop: '2px solid transparent',
                  backgroundImage: 'linear-gradient(#0d0d0d, #0d0d0d), linear-gradient(90deg, #7c3aed, #06b6d4, #7c3aed)',
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                }
          }
        >
          {sidebar && (
            <div style={{ height: '3px', background: 'linear-gradient(90deg, #7c3aed, #06b6d4, #7c3aed)', opacity: 0.9, flexShrink: 0 }} />
          )}
          {sidebar ? (
            <div className="flex shrink-0 items-center gap-2.5 px-4 py-3 select-none">
              <img
                src={zapprMascot}
                alt="Zappr"
                className={cn('size-5 object-contain', isRunning ? 'animate-zappr-run' : 'animate-zappr-idle')}
              />
              <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Zappr</span>
              <div className="ml-1 flex items-center gap-1.5">
                <span className={cn('size-[5px] rounded-full', isRunning ? 'animate-pulse bg-accent' : 'bg-green-500')} />
                <span className="text-[10px] text-fg-muted">{isRunning ? 'working...' : 'ready'}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-fg-muted opacity-50">gemini</span>
                <button
                  type="button"
                  onClick={() => { useZapprStore.setState({ isOpen: false }); }}
                  className="flex size-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div
              onMouseDown={handleHeaderMouseDown}
              className="flex cursor-grab items-center gap-2.5 px-4 py-3 select-none active:cursor-grabbing"
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px]"
                style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(6,182,212,0.25))', border: '1px solid rgba(124,58,237,0.25)' }}
              >
                <img
                  src={zapprMascot}
                  alt="Zappr"
                  className={cn('size-5 object-contain transition-transform', isRunning ? 'animate-zappr-run' : 'animate-zappr-idle')}
                />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold leading-none tracking-[-0.02em] text-fg">Zappr</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="size-[5px] rounded-full bg-green-500" />
                  <span className="text-[10px]" style={{ letterSpacing: '0.02em', color: '#3a3a3a' }}>{isRunning ? 'Zapping...' : 'ready'}</span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={close}
                  className="flex size-7 items-center justify-center rounded-[7px] text-fg-muted transition-colors hover:bg-white/5"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <CloseIcon className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          <div
            ref={responseRef}
            className={cn('min-h-0 flex-1 overflow-y-auto', sidebar ? 'px-4 py-3' : 'px-3 py-2.5')}
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Empty state */}
            {messages.length === 0 && !isRunning && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <img src={zapprMascot} alt="Zappr" className="size-10 object-contain opacity-40" />
                <p className="text-[11px] text-fg-muted">Ready to help with your code</p>
              </div>
            )}

            {/* Claude Code style message log */}
            {messages.map((msg) => (
              <div key={msg.id} className="mb-6">
                {msg.role === 'user' ? (
                  // User message — bold title line like Claude Code
                  <div className="mb-3 flex items-start gap-2">
                    <span className="mt-0.5 text-[11px] font-semibold text-fg-muted">You</span>
                    <p className="flex-1 text-[13px] font-medium text-fg">{msg.content}</p>
                  </div>
                ) : (
                  // Assistant — Claude Code agent log style
                  <div className="flex flex-col gap-2">
                    {/* Steps as Claude Code cards */}
                    {msg.steps !== undefined && msg.steps.length > 0 && (
                      <div className="space-y-2">
                        {msg.steps.map((step, i) => (
                          <div key={i} className={cn('rounded-lg overflow-hidden', sidebar && 'bg-hover border border-border-subtle')} style={sidebar ? undefined : { background: '#111', border: '1px solid rgba(255,255,255,0.08)' }}>
                            {/* Step header */}
                            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                              <span className={cn(
                                'size-[6px] rounded-full',
                                step.status === 'done' ? 'bg-green-500' :
                                step.status === 'running' ? 'animate-pulse bg-accent' :
                                step.status === 'error' ? 'bg-red-500' : 'bg-fg-muted'
                              )} />
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                step.type === 'create' ? 'bg-green-500/20 text-green-400' :
                                step.type === 'edit' ? 'bg-blue-500/20 text-blue-400' :
                                step.type === 'delete' ? 'bg-red-500/20 text-red-400' :
                                'bg-accent/20 text-accent'
                              )}>
                                {step.type === 'create' ? 'Write' : step.type === 'edit' ? 'Edit' : step.type === 'delete' ? 'Delete' : 'Run'}
                              </span>
                              <span className="flex-1 truncate font-mono text-[11px] text-fg-muted">{step.filePath}</span>
                              <span className="text-[10px] text-fg-muted">
                                {step.status === 'done' ? '✓' : step.status === 'running' ? '...' : step.status === 'error' ? '✗' : ''}
                              </span>
                            </div>
                            {/* Step description */}
                            <div className="px-3 py-1.5">
                              <p className="text-[11px] text-fg-muted">{step.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Terminal command card */}
                    {msg.terminalCommand !== undefined && msg.terminalCommand !== '' && (
                      <div className={cn('rounded-lg overflow-hidden', sidebar && 'bg-hover border border-border-subtle')} style={sidebar ? undefined : { background: '#111', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <span className="size-[6px] rounded-full bg-green-500" />
                          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-400">Bash</span>
                          <span className="flex-1 truncate font-mono text-[11px] text-fg-muted">{msg.terminalCommand}</span>
                        </div>
                        <div className="px-3 py-2">
                          <div className="flex gap-3">
                            <span className="shrink-0 text-[10px] font-semibold text-fg-muted">IN</span>
                            <code className="font-mono text-[11px] text-green-400">{msg.terminalCommand}</code>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Chat/text response */}
                    {msg.content !== '' && (
                      <div className="text-[13px] text-fg">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                          {msg.content}
                        </ReactMarkdown>
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(msg.content)}
                          className={cn('mt-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors', copied ? 'bg-success/15 text-success-text' : 'text-fg-muted hover:text-fg')}
                        >
                          {copied ? '✓ Copied!' : '📋 Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Live streaming — Claude Code style */}
            {isRunning && streamingText !== '' && (
              <div className="mb-4">
                <div className="text-[13px] text-fg">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                    {streamingText}
                  </ReactMarkdown>
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
                </div>
              </div>
            )}

            {/* Live steps — Claude Code cards */}
            {isRunning && plan !== null && (
              <div className="mb-4 space-y-2">
                {summary !== null && summary !== '' && (
                  <p className="mb-2 text-[12px] font-medium text-fg">{summary}</p>
                )}
                {steps.map(({ step, status }, i) => (
                  <div key={i} className={cn('rounded-lg overflow-hidden', sidebar && 'bg-hover border border-border-subtle')} style={sidebar ? undefined : { background: '#111', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span className={cn(
                        'size-[6px] rounded-full',
                        status === 'done' ? 'bg-green-500' :
                        status === 'running' ? 'animate-pulse bg-accent' :
                        status === 'error' ? 'bg-red-500' : 'bg-fg-muted'
                      )} />
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        step.type === 'create' ? 'bg-green-500/20 text-green-400' :
                        step.type === 'edit' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-red-500/20 text-red-400'
                      )}>
                        {step.type === 'create' ? 'Write' : step.type === 'edit' ? 'Edit' : 'Delete'}
                      </span>
                      <span className="flex-1 truncate font-mono text-[11px] text-fg-muted">{step.filePath}</span>
                      <span className="text-[10px] text-fg-muted">
                        {status === 'done' ? '✓' : status === 'running' ? '...' : status === 'error' ? '✗' : String(i + 1)}
                      </span>
                    </div>
                    <div className="px-3 py-1.5">
                      <p className="text-[11px] text-fg-muted">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {error !== null && (
              <div className="mb-4 rounded-lg px-3 py-2 text-[12px] text-danger-text" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <span>⚠ {error}</span>
                <button type="button" onClick={() => { clearError(); setPrompt(''); }} className="ml-2 underline">Try again</button>
              </div>
            )}

            {/* Action cards */}
            {lastKeyUpdateProvider !== null && (
              <div className="mb-4 rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <p className="text-[11px] font-medium text-green-400">✓ API key saved — {lastKeyUpdateProvider}</p>
              </div>
            )}

            {lastShortcutCreated !== null && (
              <div className="mb-4 rounded-lg px-3 py-2" style={{ background: lastShortcutCreated.unresolved ? 'rgba(251,191,36,0.08)' : 'rgba(34,197,94,0.08)', border: lastShortcutCreated.unresolved ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(34,197,94,0.2)' }}>
                <p className={cn('font-mono text-[11px] font-medium', lastShortcutCreated.unresolved ? 'text-yellow-400' : 'text-green-400')}>
                  ✓ [{lastShortcutCreated.keys}] → {lastShortcutCreated.description}
                </p>
              </div>
            )}

            {lastTerminalCommand !== null && (
              <div className={cn('mb-4 rounded-lg overflow-hidden', sidebar && 'bg-hover border border-border-subtle')} style={sidebar ? undefined : { background: '#111', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="size-[6px] rounded-full bg-green-500" />
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-400">Bash</span>
                  <span className="font-mono text-[11px] text-fg-muted">{lastTerminalCommand}</span>
                </div>
                <div className="px-3 py-2 space-y-1">
                  <div className="flex gap-3">
                    <span className="shrink-0 text-[10px] font-semibold text-fg-muted">IN</span>
                    <code className="font-mono text-[11px] text-green-400">{lastTerminalCommand}</code>
                  </div>
                  {chatResponse !== null && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[10px] font-semibold text-fg-muted">OUT</span>
                      <code className="font-mono text-[11px] text-fg-muted">{chatResponse}</code>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        {!isRunning && (messages.length > 0 || steps.length > 0 || chatResponse !== null) && (
          <div className="shrink-0 border-t border-white/10 px-3 pt-2 pb-3">
            <button
              type="button"
              onClick={() => {
                clearError();
                setPrompt('');
                clearMessages();
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
              {messages.length > 0 ? `⚡ New Chat (${String(messages.length)} msgs)` : '⚡ New Zap'}
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

        {!isRunning && plan === null && selectedCode !== null && (
          <div
            className="mx-4 mb-2 overflow-hidden rounded-lg"
            style={{ border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.05)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5"
              style={{ borderBottom: '1px solid rgba(124,58,237,0.1)' }}
            >
              <span className="text-[10px] font-medium" style={{ color: '#a78bfa' }}>
                ⚡ {selectedCodeFile !== null ? (selectedCodeFile.split('/').pop() ?? selectedCodeFile) : 'Selected code'}
              </span>
              <button
                type="button"
                onClick={() => {
                  useZapprStore.setState({ selectedCode: null, selectedCodeFile: null });
                }}
                className="text-[10px] transition-colors hover:text-fg"
                style={{ color: '#444' }}
              >
                ✕
              </button>
            </div>
            <pre
              className="max-h-[80px] overflow-x-auto overflow-y-auto px-3 py-2 font-mono text-[11px]"
              style={{ color: '#666', margin: 0 }}
            >
              {selectedCode.slice(0, 300)}
              {selectedCode.length > 300 ? '...' : ''}
            </pre>
          </div>
        )}

        {!isRunning && plan === null && sidebar && (
          <div className="shrink-0 border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-raised px-3 py-2.5">
              <span className="mt-[3px] shrink-0 text-[12px] font-mono text-fg-muted">{'>'}</span>
              <textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim() !== '') void run();
                  }
                }}
                placeholder="Ask anything about your code..."
                className="min-h-[20px] max-h-[120px] w-full resize-none bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
                style={{ lineHeight: '1.6' }}
                autoFocus
                rows={1}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${String(Math.min(el.scrollHeight, 120))}px`;
                }}
              />
              <button
                type="button"
                onClick={() => void run()}
                disabled={prompt.trim() === '' || isRunning}
                className="mt-0.5 shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white transition-all disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' }}
              >
                ↵
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-fg-muted opacity-40">Enter to send · Shift+Enter new line</p>
          </div>
        )}

        {!isRunning && plan === null && !sidebar && (
          <div className="shrink-0 px-3 py-2.5">
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
              className="min-h-[60px] max-h-[150px] w-full resize-none rounded-xl p-4 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus:shadow-[0_0_20px_rgba(124,58,237,0.15)] focus:ring-2 focus:ring-accent/40"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}
              autoFocus
            />
          </div>
        )}

        {!isRunning && plan === null && !sidebar && (
          <div className="mt-2 flex shrink-0 items-center gap-2 px-4 pb-3">
            <div className="flex flex-1 gap-1.5 overflow-hidden">
              {activeFile !== null && (
                <div
                  className="flex items-center gap-1 rounded-[5px] px-2 py-1 text-[9px] text-fg-muted"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1h6M1 4h4M1 7h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                  {activeFile.split('/').pop() ?? activeFile}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void run()}
              disabled={prompt.trim() === ''}
              className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-4 py-[7px] text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: '1px solid rgba(124,58,237,0.5)' }}
            >
              ⚡ Zap
            </button>
          </div>
        )}
        </div>
      </div>
  );
}
