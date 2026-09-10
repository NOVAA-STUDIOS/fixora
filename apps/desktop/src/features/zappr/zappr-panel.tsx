import { CloseIcon, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import zapprMascot from '../../assets/zappr-mascot.png';
import { useZapprStore } from '../../stores/zappr-store.js';
import { useEditorStore } from '../editor/editor-store.js';

const QUICK_PROMPTS = ['fix errors in file', 'create component', 'run git status', 'explain this code'];
/** 'ask' is a display-only alias for 'chat' — the store has no separate mode for it. */
const MODE_PILLS = ['chat', 'repair', 'file', 'ask'] as const;

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
  // 'chat' and 'ask' both map to the store's 'chat' mode, so the active pill can't be derived
  // from `mode` alone — tracked separately here to tell the two apart.
  const [selectedPill, setSelectedPill] = useState<(typeof MODE_PILLS)[number]>('chat');

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
            ? 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#0a0a0a]'
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
          className={cn('flex flex-1 flex-col bg-[#0d0d0d]', !sidebar && 'rounded-[13px]')}
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
          <div
            onMouseDown={sidebar ? undefined : handleHeaderMouseDown}
            className={cn(
              'flex items-center gap-2.5 select-none',
              sidebar ? 'px-5 py-4' : 'px-4 py-3',
              !sidebar && 'cursor-grab active:cursor-grabbing',
            )}
          >
            <div
              className={cn(
                'flex shrink-0 items-center justify-center',
                sidebar ? 'size-9 rounded-[12px]' : 'size-8 rounded-[10px]',
              )}
              style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(6,182,212,0.25))', border: '1px solid rgba(124,58,237,0.25)' }}
            >
              <img
                src={zapprMascot}
                alt="Zappr"
                className={cn('size-5 object-contain transition-transform', isRunning ? 'animate-zappr-run' : 'animate-zappr-idle')}
              />
            </div>
            <div className="flex flex-col">
              <span className={cn('leading-none tracking-[-0.02em] text-fg', sidebar ? 'text-[14px] font-bold' : 'text-[13px] font-semibold')}>Zappr</span>
              <div className="mt-1 flex items-center gap-1.5">
                <div className={cn('rounded-full bg-green-500', sidebar ? 'size-[6px]' : 'size-[5px]')} />
                <span className={sidebar ? 'text-[11px]' : 'text-[10px]'} style={{ letterSpacing: '0.02em', color: '#3a3a3a' }}>{isRunning ? 'Zapping...' : 'ready'}</span>
              </div>
            </div>
            {!sidebar && (
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
            )}
          </div>

          <div className={cn('mx-4 mb-3 flex rounded-[10px] p-1.5', sidebar ? 'gap-1.5' : 'gap-1')} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
            {MODE_PILLS.map((m) => {
              const storeMode = m === 'ask' ? 'chat' : m;
              const active = selectedPill === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSelectedPill(m);
                    useZapprStore.setState({ mode: storeMode });
                  }}
                  className={cn(
                    'flex-1 rounded-[7px] font-medium capitalize transition-all',
                    sidebar ? 'py-[6px] text-[11px]' : 'py-[5px] text-[10px]',
                  )}
                  style={
                    active
                      ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }
                      : { border: '1px solid transparent', color: '#444' }
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>

          <div
            ref={responseRef}
            className={cn('min-h-0 flex-1 overflow-y-auto', sidebar ? 'px-4 py-3' : 'px-3 py-2.5')}
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Empty state */}
            {messages.length === 0 && !isRunning && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <img src={zapprMascot} alt="Zappr" className="size-12 object-contain opacity-60" />
                <p className="text-[12px] text-fg-muted">Ask anything about your code</p>
              </div>
            )}

            {/* Message history */}
            {messages.map((msg) => (
              <div key={msg.id} className={cn('mb-4', msg.role === 'user' ? 'flex justify-end' : 'flex flex-col gap-1')}>
                {msg.role === 'user' ? (
                  <div
                    className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-[13px] text-fg"
                    style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.2)' }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <img src={zapprMascot} alt="" className="size-4 object-contain" />
                      <span className="text-[10px] font-semibold text-accent">Zappr</span>
                      <span className="text-[10px] text-fg-muted">
                        · {msg.type === 'file' ? 'Code agent' : msg.type === 'repair' ? 'Debug mode' : 'Assistant'}
                      </span>
                    </div>
                    {/* Steps */}
                    {msg.steps && msg.steps.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {msg.steps.map((step, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <span className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-full text-[9px]',
                              step.status === 'done' ? 'bg-success/20 text-success-text' :
                              step.status === 'running' ? 'animate-pulse bg-accent/20 text-accent' :
                              step.status === 'error' ? 'bg-danger/20 text-danger-text' :
                              'bg-border-subtle text-fg-muted'
                            )}>
                              {step.status === 'done' ? '✓' : step.status === 'running' ? '⟳' : step.status === 'error' ? '✗' : String(i + 1)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{step.filePath}</span>
                            <span className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium',
                              step.type === 'create' ? 'bg-success/15 text-success-text' :
                              step.type === 'edit' ? 'bg-accent/15 text-accent-text' :
                              'bg-danger/15 text-danger-text'
                            )}>{step.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Terminal command */}
                    {msg.terminalCommand !== undefined && msg.terminalCommand !== '' && (
                      <div className="mb-2 rounded-lg px-3 py-2 font-mono text-[11px] text-green-400" style={{ background: 'color-mix(in srgb, black 60%, transparent)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        $ {msg.terminalCommand}
                      </div>
                    )}
                    {/* Chat content */}
                    {msg.content !== '' && (
                      <div className="text-[13px] text-fg">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                          {msg.content}
                        </ReactMarkdown>
                        <button
                          type="button"
                          onClick={() => void copyToClipboard(msg.content)}
                          className={cn(
                            'mt-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                            copied ? 'bg-success/15 text-success-text' : 'text-fg-muted hover:text-fg',
                          )}
                        >
                          {copied ? '✓ Copied!' : '📋 Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Streaming response */}
            {isRunning && streamingText !== '' && (
              <div className="mb-4 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <img src={zapprMascot} alt="" className="size-4 animate-pulse object-contain" />
                  <span className="text-[10px] font-semibold text-accent">Zappr</span>
                  <span className="animate-pulse text-[10px] text-fg-muted">· thinking...</span>
                </div>
                <div className="text-[13px] text-fg">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                    {streamingText}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Running steps (live) */}
            {isRunning && plan !== null && (
              <div className="mb-4 space-y-1">
                {summary !== null && summary !== '' && (
                  <p className="mb-2 text-[11px] text-fg-secondary">{summary}</p>
                )}
                {steps.map(({ step, status }, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full text-[9px]',
                      status === 'done' ? 'bg-success/20 text-success-text' :
                      status === 'running' ? 'animate-pulse bg-accent/20 text-accent' :
                      status === 'error' ? 'bg-danger/20 text-danger-text' :
                      'bg-border-subtle text-fg-muted'
                    )}>
                      {status === 'done' ? '✓' : status === 'running' ? '⟳' : status === 'error' ? '✗' : String(i + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">{step.filePath}</span>
                    <span className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium',
                      step.type === 'create' ? 'bg-success/15 text-success-text' :
                      step.type === 'edit' ? 'bg-accent/15 text-accent-text' :
                      'bg-danger/15 text-danger-text'
                    )}>{step.type}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {error !== null && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger-text" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
                <span>⚠</span>
                <div className="flex-1">
                  {error}
                  <button type="button" onClick={() => { clearError(); setPrompt(''); }} className="ml-2 underline">Try again</button>
                </div>
              </div>
            )}

            {/* Action cards */}
            {lastKeyUpdateProvider !== null && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2">
                <span>🔑</span>
                <div>
                  <p className="text-[11px] font-medium text-success-text">API key saved</p>
                  <p className="text-[10px] text-fg-muted">Provider: {lastKeyUpdateProvider}</p>
                </div>
              </div>
            )}

            {lastShortcutCreated !== null && (
              <div className={cn('mb-4 flex items-center gap-2 rounded-lg border px-3 py-2', lastShortcutCreated.unresolved ? 'border-warn/30 bg-warn/10' : 'border-success/30 bg-success/10')}>
                <span>⌨</span>
                <div>
                  <p className={cn('font-mono text-[11px] font-medium', lastShortcutCreated.unresolved ? 'text-warn-text' : 'text-success-text')}>[{lastShortcutCreated.keys}]</p>
                  <p className="text-[10px] text-fg-muted">→ {lastShortcutCreated.description}</p>
                </div>
              </div>
            )}

            {lastTerminalCommand !== null && (
              <div className="mb-4 rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, black 60%, transparent)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="font-mono text-[11px] text-green-400">$ {lastTerminalCommand}</p>
                {chatResponse !== null && <p className="mt-1 text-[11px] text-fg-muted">{chatResponse}</p>}
                {chatResponse !== null && !chatResponse.startsWith('Terminal not open') && <p className="mt-1 text-[10px] text-fg-muted">→ Sent to terminal</p>}
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

        {!isRunning && plan === null && (
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
              className={cn(
                'max-h-[150px] w-full resize-none rounded-xl text-fg outline-none transition-colors placeholder:text-fg-muted focus:shadow-[0_0_20px_rgba(124,58,237,0.15)] focus:ring-2 focus:ring-accent/40',
                sidebar ? 'min-h-[80px] px-4 py-3.5 text-[13px]' : 'min-h-[60px] p-4 text-sm',
              )}
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px' }}
              autoFocus
            />
          </div>
        )}

        {!isRunning && plan === null && (
          <div className={cn('mt-2 flex shrink-0 items-center gap-2', sidebar ? 'px-5 pb-4' : 'px-4 pb-3')}>
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
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-[8px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40',
                sidebar ? 'px-5 py-2 text-[12px]' : 'px-4 py-[7px] text-[11px]',
              )}
              style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: '1px solid rgba(124,58,237,0.5)' }}
            >
              ⚡ Zap
            </button>
          </div>
        )}

        {!isRunning && plan === null && (
          <div className={cn('shrink-0', sidebar ? 'px-5 pb-4' : 'px-4 pb-3')} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            <div className="flex flex-wrap gap-1.5 pt-3">
              {QUICK_PROMPTS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setPrompt(suggestion);
                  }}
                  className={cn(
                    'rounded-full transition-colors hover:border-white/10',
                    sidebar ? 'px-3 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[10px]',
                  )}
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', color: '#4a4a4a' }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
  );
}
