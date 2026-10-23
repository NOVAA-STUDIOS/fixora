import { CloseIcon, cn } from '@fixora/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import zapprMascot from '../../assets/zappr-mascot.png';
import { invoke } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useZapprStore } from '../../stores/zappr-store.js';
import { useEditorStore } from '../editor/editor-store.js';
import { modelTextFor } from '../editor/models.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { activeFallbackPath, indexMentionFiles, insertMention, normalizeMentionPath, parseMentionPaths, searchMentionFiles } from './mention-context.js';
import { SmartContextIndicator } from './smart-context-indicator.js';
import { indexSmartContextFiles, rankSmartProjectContext, type SmartContextCandidate } from './smart-project-context.js';

function ZapprActivityStatus(): React.JSX.Element {
  const isRunning = useZapprStore((s) => s.isRunning);
  const isCancelling = useZapprStore((s) => s.isCancelling);
  const isApproving = useZapprStore((s) => s.isApproving);
  const pendingApprovalId = useZapprStore((s) => s.pendingApprovalId);
  const mode = useZapprStore((s) => s.mode);
  const plan = useZapprStore((s) => s.plan);
  const steps = useZapprStore((s) => s.steps);
  const streamingText = useZapprStore((s) => s.streamingText);
  let status: string | null = null;
  if (isCancelling) status = 'Cancelling…';
  else if (pendingApprovalId !== null) status = 'Waiting for approval';
  else if (isRunning) {
    if ((isApproving || steps.some(({ status: stepStatus }) => stepStatus === 'running')) && steps.length > 0) status = 'Cooking…';
    else if (isApproving) status = 'Applying changes…';
    else if (streamingText !== '') status = mode === 'chat' || mode === 'math' ? 'Preparing response…' : 'Preparing changes…';
    else if (plan !== null) status = 'Reviewing plan…';
    else status = mode === 'file' || mode === 'repair' ? 'Preparing changes…' : 'Thinking…';
  }
  return <>{status ?? 'ready'}</>;
}

function ZapprStreamingPreview({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }): React.JSX.Element | null {
  const streamingText = useZapprStore((s) => s.streamingText);
  const hasSteps = useZapprStore((s) => s.steps.length > 0);
  useEffect(() => {
    if (streamingText !== '' && !hasSteps && scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [hasSteps, scrollRef, streamingText]);
  if (streamingText === '' || hasSteps) return null;
  return (
    <div className="mt-1 rounded-lg border border-border-subtle bg-inset px-3 py-2">
      <p className="line-clamp-3 font-mono text-[11px] text-fg-muted">{streamingText}</p>
      <span className="inline-block h-2.5 w-[2px] animate-pulse bg-accent align-middle ml-0.5" />
    </div>
  );
}

function playSuccessSound(): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    oscillator.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    oscillator.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5

    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);

    oscillator.onended = () => { void ctx.close(); };
  } catch { /* audio not available */ }
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token (GPT/Claude standard)
  return Math.ceil(text.length / 4);
}

function actionCounts(steps: { type: string }[]): { create: number; edit: number; delete: number } {
  return steps.reduce((counts, step) => {
    if (step.type === 'create') counts.create += 1;
    if (step.type === 'edit') counts.edit += 1;
    if (step.type === 'delete') counts.delete += 1;
    return counts;
  }, { create: 0, edit: 0, delete: 0 });
}

function stepStatusLabel(status: 'pending' | 'running' | 'done' | 'error'): string {
  return status === 'running' ? 'Writing' : status === 'done' ? 'Done' : status === 'error' ? 'Failed' : 'Pending';
}

function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [codeCopied, setCodeCopied] = useState(false);
  const codeText = Array.isArray(children)
    ? children.filter((c): c is string => typeof c === 'string').join('')
    : typeof children === 'string'
      ? children
      : '';
  return (
    <div className="relative group my-3">
      <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-inset px-4 py-3.5 font-mono text-[13px] leading-relaxed">
        <code>{children}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(codeText).then(() => {
            setCodeCopied(true);
            setTimeout(() => { setCodeCopied(false); }, 2000);
          });
        }}
        className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-border-subtle bg-raised px-2 py-1 text-[11px] font-medium text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
      >
        {codeCopied ? '✓ Copied' : '⎘ Copy'}
      </button>
    </div>
  );
}

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
      <CodeBlock>{children}</CodeBlock>
    ) : (
      <code className="rounded bg-inset px-1.5 py-0.5 font-mono text-[13px] text-accent-text">{children}</code>
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
  const error = useZapprStore((s) => s.error);
  const mode = useZapprStore((s) => s.mode);
  const chatResponse = useZapprStore((s) => s.chatResponse);
  const currentFilePath = useZapprStore((s) => s.currentFilePath);
  const currentFileContent = useZapprStore((s) => s.currentFileContent);
  const lastTerminalCommand = useZapprStore((s) => s.lastTerminalCommand);
  const outcome = useZapprStore((s) => s.outcome);
  const commandRunRequest = useZapprStore((s) => s.commandRunRequest);
  const consumeCommandRunRequest = useZapprStore((s) => s.consumeCommandRunRequest);
  const lastKeyUpdateProvider = useZapprStore((s) => s.lastKeyUpdateProvider);
  const lastShortcutCreated = useZapprStore((s) => s.lastShortcutCreated);
  const selectedCode = useZapprStore((s) => s.selectedCode);
  const selectedCodeFile = useZapprStore((s) => s.selectedCodeFile);
  const selectedCodeStartLine = useZapprStore((s) => s.selectedCodeStartLine);
  const selectedCodeEndLine = useZapprStore((s) => s.selectedCodeEndLine);
  const selectedCodeWorkspaceRoot = useZapprStore((s) => s.selectedCodeWorkspaceRoot);
  const pendingApprovalId = useZapprStore((s) => s.pendingApprovalId);
  const isApproving = useZapprStore((s) => s.isApproving);
  const close = useZapprStore((s) => s.close);
  const setPrompt = useZapprStore((s) => s.setPrompt);
  const clearError = useZapprStore((s) => s.clearError);
  const run = useZapprStore((s) => s.run);
  const cancel = useZapprStore((s) => s.cancel);
  const approvePendingPlan = useZapprStore((s) => s.approvePendingPlan);
  const rejectPendingPlan = useZapprStore((s) => s.rejectPendingPlan);
  const listen = useZapprStore((s) => s.listen);
  const messages = useZapprStore((s) => s.messages);
  const clearMessages = useZapprStore((s) => s.clearMessages);
  const clearSelectedCode = useZapprStore((s) => s.clearSelectedCode);
  const mentionFiles = useZapprStore((s) => s.mentionFiles);
  const setMentionFiles = useZapprStore((s) => s.setMentionFiles);
  const removeMentionFile = useZapprStore((s) => s.removeMentionFile);
  const clearMentionFiles = useZapprStore((s) => s.clearMentionFiles);
  const [copied, setCopied] = useState(false);
  const [atSuggestions, setAtSuggestions] = useState<string[]>([]);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [mentionWarning, setMentionWarning] = useState<string | null>(null);
  const [smartContextEnabled, setSmartContextEnabled] = useState(true);
  const [autoContextFiles, setAutoContextFiles] = useState<SmartContextCandidate[]>([]);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const handledCommandRunId = useRef<string | null>(null);
  const workspaceNodes = useWorkspaceStore((s) => s.nodes);
  const workspaceFiles = useMemo(
    () => workspaceNodes.filter((n) => n.kind === 'file').map((n) => n.relPath),
    [workspaceNodes],
  );
  const mentionFileIndex = useMemo(() => indexMentionFiles(workspaceFiles), [workspaceFiles]);
  const promptMentionPaths = useMemo(() => parseMentionPaths(prompt), [prompt]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const autoFixOnSave = useUiStore((s) => s.autoFixOnSave);
  const toggleAutoFixOnSave = useUiStore((s) => s.toggleAutoFixOnSave);
  const activeFile = useEditorStore((s) => s.activeTab);
  const editorTabs = useEditorStore((s) => s.tabs);
  const smartContextIndex = useMemo(
    () => indexSmartContextFiles([...workspaceFiles, ...editorTabs.map((tab) => tab.relPath)]),
    [editorTabs, workspaceFiles],
  );

  useEffect(() => listen(), [listen]);

  const workspaceRoot = useWorkspaceStore((s) => s.workspace?.rootPath ?? null);
  const selectionIsCurrent = workspaceRoot !== null && selectedCodeWorkspaceRoot === workspaceRoot;
  const [availableActiveFile, setAvailableActiveFile] = useState<{ path: string; workspaceRoot: string } | null>(null);
  const activeFileIsTab = activeFile !== null && editorTabs.some((tab) => tab.relPath === activeFile);
  useEffect(() => {
    let current = true;
    setAvailableActiveFile(null);
    if (!activeFileIsTab || workspaceRoot === null) return () => { current = false; };
    const slash = activeFile.lastIndexOf('/');
    const parent = slash < 0 ? '' : activeFile.slice(0, slash);
    void invoke('fs:listDir', { relPath: parent }).then((result) => {
      if (!current || useWorkspaceStore.getState().workspace?.rootPath !== workspaceRoot) return;
      if (result.ok && result.value.entries.some((entry) => entry.kind === 'file' && entry.relPath === activeFile)) {
        setAvailableActiveFile({ path: activeFile, workspaceRoot });
      }
    }).catch(() => {
      // A closed/deleted/unreadable editor file is not context.
    });
    return () => { current = false; };
  }, [activeFile, activeFileIsTab, workspaceNodes, workspaceRoot]);
  const previousWorkspaceRoot = useRef(workspaceRoot);
  useEffect(() => {
    if (previousWorkspaceRoot.current !== workspaceRoot) {
      clearSelectedCode();
      clearMentionFiles();
      setAutoContextFiles([]);
      setSmartContextEnabled(true);
      const currentPrompt = useZapprStore.getState().prompt;
      setPrompt(currentPrompt.replace(/(^|\s)@[\w./-]+/g, '$1'));
      setAtSuggestions([]);
      setAtQuery(null);
      setMentionWarning(null);
    }
    previousWorkspaceRoot.current = workspaceRoot;
  }, [clearMentionFiles, clearSelectedCode, setPrompt, workspaceRoot]);

  async function runWithMentionContext(promptSnapshot = prompt): Promise<void> {
    setAutoContextFiles([]);
    const rootAtStart = useWorkspaceStore.getState().workspace?.rootPath ?? null;
    const editorAtStart = useEditorStore.getState();
    const activeFileAtStart = editorAtStart.activeTab;
    const openTabsAtStart = editorAtStart.tabs.map((tab) => tab.relPath);
    const smartContextIndexAtStart = smartContextIndex;
    const smartContextEnabledAtStart = smartContextEnabled;
    const zapprAtStart = useZapprStore.getState();
    const selectionBelongsHere = rootAtStart !== null && zapprAtStart.selectedCodeWorkspaceRoot === rootAtStart;
    const selectedCodeAtStart = selectionBelongsHere ? zapprAtStart.selectedCode : null;
    const selectedCodeFileAtStart = selectionBelongsHere ? zapprAtStart.selectedCodeFile : null;
    const importSourceFile = selectedCodeAtStart !== null
      ? selectedCodeFileAtStart ?? activeFileAtStart
      : activeFileAtStart;
    const importSourceContent = importSourceFile === null
      ? null
      : modelTextFor(importSourceFile) ?? (importSourceFile === selectedCodeFileAtStart ? selectedCodeAtStart : null);
    const allCandidates = parseMentionPaths(promptSnapshot);
    const candidates = allCandidates.slice(0, 8);
    const resolved: string[] = [];
    for (const candidate of candidates) {
      const safePath = normalizeMentionPath(candidate);
      if (safePath === null) continue;
      const slash = safePath.lastIndexOf('/');
      const parent = slash < 0 ? '' : safePath.slice(0, slash);
      const name = slash < 0 ? safePath : safePath.slice(slash + 1);
      try {
        const listed = await invoke('fs:listDir', { relPath: parent });
        if (listed.ok && listed.value.entries.some((entry) => entry.kind === 'file' && entry.name === name && entry.relPath === safePath)) resolved.push(safePath);
      } catch {
        // A missing/unreadable mention is omitted; it must not block the rest of the request.
      }
    }
    if (useWorkspaceStore.getState().workspace?.rootPath !== rootAtStart) return;
    const selectedFile = selectedCodeFileAtStart;
    const validMentionCount = new Set(resolved).size;
    const effective = [...new Set(resolved)].filter((file) => file !== selectedFile);
    let validActiveFile: string | null = activeFileAtStart;
    if (activeFileAtStart !== null && activeFileAtStart !== selectedFile && !effective.includes(activeFileAtStart)) {
      const slash = activeFileAtStart.lastIndexOf('/');
      const parent = slash < 0 ? '' : activeFileAtStart.slice(0, slash);
      try {
        const listed = await invoke('fs:listDir', { relPath: parent });
        if (!listed.ok || !listed.value.entries.some((entry) => entry.kind === 'file' && entry.relPath === activeFileAtStart)) validActiveFile = null;
      } catch {
        validActiveFile = null;
      }
    } else if (activeFileAtStart === selectedFile || effective.includes(activeFileAtStart ?? '')) {
      validActiveFile = activeFileAtStart;
    }
    if (useWorkspaceStore.getState().workspace?.rootPath !== rootAtStart) return;
    const smartCandidates = smartContextEnabledAtStart
      ? rankSmartProjectContext(smartContextIndexAtStart, {
          prompt: promptSnapshot,
          activeFile: validActiveFile,
          selectedCode: selectedCodeAtStart,
          selectedCodeFile: selectedCodeAtStart === null ? null : selectedCodeFileAtStart,
          sourceContent: importSourceContent,
          explicitFiles: effective,
          openTabs: openTabsAtStart,
        })
      : [];
    setAutoContextFiles(smartCandidates);
    setMentionFiles(effective);
    setMentionWarning(allCandidates.length > validMentionCount ? 'Some mentioned files are unavailable or over the context limit and were skipped.' : null);
    await run({
      activeFile: validActiveFile,
      openTabs: openTabsAtStart,
      selectedCode: selectedCodeAtStart,
      selectedCodeFile: selectedCodeFileAtStart,
      atMentions: effective,
      smartContextFiles: smartCandidates.map((candidate) => candidate.path),
    });
  }

  const runWithMentionContextRef = useRef(runWithMentionContext);
  runWithMentionContextRef.current = runWithMentionContext;

  useEffect(() => {
    if (commandRunRequest === null || handledCommandRunId.current === commandRunRequest.id) return;
    handledCommandRunId.current = commandRunRequest.id;
    const currentWorkspace = useWorkspaceStore.getState().workspace?.rootPath ?? null;
    const currentZappr = useZapprStore.getState();
    consumeCommandRunRequest(commandRunRequest.id);
    if (
      currentWorkspace !== commandRunRequest.workspaceRoot ||
      currentZappr.isRunning ||
      currentZappr.activeRunId !== null ||
      currentZappr.pendingApprovalId !== null
    ) return;
    void runWithMentionContextRef.current(commandRunRequest.prompt);
  }, [commandRunRequest, consumeCommandRunRequest]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  function chooseMention(file: string): void {
    const input = promptInputRef.current;
    if (input === null || atQuery === null) return;
    const cursor = input.selectionStart;
    const queryStart = prompt.lastIndexOf('@', cursor - 1);
    if (queryStart < 0) return;
    if (parseMentionPaths(prompt).includes(file)) {
      setAtSuggestions([]);
      setAtQuery(null);
      return;
    }
    const queryEnd = cursor + (/^[\w./-]*/.exec(prompt.slice(cursor))?.[0].length ?? 0);
    const inserted = insertMention(prompt, queryStart, queryEnd, file);
    setPrompt(inserted.text);
    setMentionFiles([...mentionFiles, file]);
    setAtSuggestions([]);
    setAtQuery(null);
    setActiveSuggestion(0);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function removeMention(file: string): void {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nextPrompt = prompt.replace(new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`, 'g'), '$1').replace(/ {2,}/g, ' ');
    setPrompt(nextPrompt);
    removeMentionFile(file);
  }

  const visibleMentionFiles = useMemo(
    () => [...new Set([...mentionFiles, ...promptMentionPaths])]
      .filter((file) => !selectionIsCurrent || file !== selectedCodeFile),
    [mentionFiles, promptMentionPaths, selectedCodeFile, selectionIsCurrent],
  );
  const activeFallbackFile = availableActiveFile?.path === activeFile
    && availableActiveFile.workspaceRoot === workspaceRoot
    && activeFileIsTab
    ? activeFallbackPath(activeFile, selectionIsCurrent ? selectedCodeFile : null, visibleMentionFiles)
    : null;
  const hasFileContext =
    (selectedCode !== null && selectionIsCurrent) ||
    visibleMentionFiles.length > 0 ||
    activeFallbackFile !== null;

  async function runSelectionAction(instruction: string): Promise<void> {
    const file = useZapprStore.getState().selectedCodeFile;
    const actionPrompt = `${instruction}\nFile: ${file ?? 'current file'}`;
    setPrompt(actionPrompt);
    await runWithMentionContext(actionPrompt);
    clearSelectedCode();
  }

  useEffect(() => {
    console.warn('[Zappr:UI] State →', mode, isRunning ? 'running' : 'idle');
  }, [mode, isRunning]);

  const panelRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (responseRef.current !== null) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [isRunning, messages]);

  useEffect(() => {
    if (isRunning && responseRef.current !== null) {
      responseRef.current.scrollTop = 0;
    }
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && /file.*written/i.test(last.content)) {
        setCelebrating(true);
        playSuccessSound();
        setTimeout(() => { setCelebrating(false); }, 700);
      }
    }
  }, [isRunning, messages]);

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
            : 'animate-ios-dialog-enter absolute right-4 bottom-4 z-50 flex w-[360px] max-w-[90vw] flex-col rounded-xl border border-accent-border bg-raised shadow-xl'
        }
        style={
          sidebar
            ? { maxHeight: '100vh' }
            : { maxHeight: 'calc(100vh - 80px)' }
        }
      >
        <div
          className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-raised', !sidebar && 'rounded-xl')}
        >
          {sidebar && (
            <div className="h-[3px] shrink-0 bg-accent" />
          )}
          {sidebar ? (
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 px-3 py-2.5 select-none">
              <img
                src={zapprMascot}
                alt="Zappr"
                className={cn('size-5 object-contain',
                  celebrating ? 'animate-zappr-celebrate' :
                  isRunning ? 'animate-zappr-thinking' :
                  'animate-zappr-idle'
                )}
              />
              <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">Zappr</span>
              <div className="ml-1 flex min-w-0 items-center gap-1.5">
                <span className={cn('size-[5px] rounded-full', isRunning ? 'animate-pulse bg-accent' : 'bg-success')} />
                <span className="text-[11px] text-fg-muted"><ZapprActivityStatus /></span>
                {isRunning && (
                  <SmartContextIndicator enabled={smartContextEnabled} files={autoContextFiles} onToggle={null} showToggle={false} />
                )}
              </div>
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
                <span className="shrink-0 text-[11px] text-fg-muted opacity-70">AI</span>
                <button
                  type="button"
                  onClick={toggleAutoFixOnSave}
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
                    autoFixOnSave
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                  title={autoFixOnSave ? 'Auto-fix on save: ON' : 'Auto-fix on save: OFF'}
                >
                  {autoFixOnSave ? '⚡ Auto' : '○ Auto'}
                </button>
                {!isRunning && activeFile !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt(`Review this file: ${activeFile}`);
                      void run();
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                    title={`Review ${activeFile}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1 2.5h8M1 5h6M1 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    Review
                  </button>
                )}
                {!isRunning && (
                  <button
                    type="button"
                    onClick={() => {
                      setPrompt('Generate a conventional commit message for my recent changes. Use format: type(scope): description');
                      void run();
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                    title="Generate commit message"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/>
                      <circle cx="5" cy="5" r="1.5" fill="currentColor"/>
                      <line x1="1" y1="5" x2="3.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <line x1="6.5" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    Commit
                  </button>
                )}
                {messages.length > 0 && !isRunning && (
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
                        currentStep: 0,
                        mode: null,
                        currentFilePath: null,
                        currentFileContent: null,
                        lastTerminalCommand: null,
                        lastKeyUpdateProvider: null,
                        lastShortcutCreated: null,
                      });
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                    title="New Chat"
                  >
                    ⚡ New
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Close Zappr"
                  onClick={() => { useZapprStore.setState({ isOpen: false }); }}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
          {sidebar && isRunning && (
            <div className="h-[2px] w-full shrink-0 overflow-hidden bg-hover">
              <div
                className="h-full animate-pulse"
                style={{
                  background: 'linear-gradient(90deg, transparent, var(--fx-color-accent-solid), transparent)',
                  animation: 'zappr-progress 1.5s ease-in-out infinite',
                  width: '60%',
                }}
              />
            </div>
          )}
          {!sidebar && (
            <div
              onMouseDown={handleHeaderMouseDown}
              className="flex cursor-grab items-center gap-2.5 px-4 py-3 select-none active:cursor-grabbing"
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-accent-border bg-accent-subtle"
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
                  <div className="size-[5px] rounded-full bg-success" />
                  <span className="text-[11px] tracking-wide text-fg-muted"><ZapprActivityStatus /></span>
                  {isRunning && (
                    <SmartContextIndicator enabled={smartContextEnabled} files={autoContextFiles} onToggle={null} showToggle={false} />
                  )}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close Zappr"
                  className="flex size-7 items-center justify-center rounded-[7px] border border-border-subtle text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <CloseIcon className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          <div
            ref={responseRef}
            data-zappr-scroll=""
            className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', sidebar ? 'px-4 py-3' : 'px-3 py-2.5')}
            style={{ scrollbarWidth: 'none', maxHeight: '100%' }}
          >
            {/* Empty state */}
            {messages.length === 0 && !isRunning && pendingApprovalId === null && (
              <div className="flex min-h-full min-w-0 flex-col items-center justify-center gap-2.5 px-3 py-5 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl border border-border-subtle bg-inset">
                  <img src={zapprMascot} alt="" className="size-6 object-contain opacity-70" />
                </span>
                <p className="text-sm font-semibold text-fg">Ready when you are</p>
                <p className="max-w-[240px] text-xs leading-relaxed text-fg-muted">
                  {hasFileContext
                    ? 'Ask a question or describe what you need.'
                    : 'No file context yet. Ask a question or type @ to add a file.'}
                </p>
              </div>
            )}

            {/* Claude Code style message log */}
            {messages.map((msg, msgIndex) => (
              <div key={msg.id} className="mb-5 last:mb-0">
                {msg.role === 'user' ? (
                  // User message — bold title line like Claude Code
                  <div className="mb-3 flex min-w-0 items-start gap-3 rounded-xl border border-border-subtle bg-inset px-3 py-2.5">
                    <span className="mt-0.5 shrink-0 rounded border border-border-subtle bg-raised px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-fg-muted">You</span>
                    <p className="min-w-0 flex-1 break-words text-[13px] leading-relaxed text-fg">{msg.content}</p>
                  </div>
                ) : (
                  // Assistant — Claude Code agent log style
                  <div className="flex min-w-0 flex-col gap-2.5 border-l border-accent/25 pl-3">
                    {/* Steps as Claude Code cards */}
                    {msg.steps !== undefined && msg.steps.length > 0 && (
                      <div className="space-y-2">
                        {msg.steps.map((step, i) => (
                          <div
                            key={i}
                            role="button"
                            tabIndex={0}
                            aria-expanded={expandedStep === `${msg.id}-${String(i)}`}
                            className={cn('overflow-hidden rounded-xl border border-border-subtle text-left transition-colors duration-150 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring', sidebar && 'bg-hover')}
                            onClick={() => { setExpandedStep(expandedStep === `${msg.id}-${String(i)}` ? null : `${msg.id}-${String(i)}`); }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setExpandedStep(expandedStep === `${msg.id}-${String(i)}` ? null : `${msg.id}-${String(i)}`);
                              }
                            }}
                          >
                            {/* Step header */}
                            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
                              <span className={cn(
                                'size-[6px] rounded-full',
                                step.status === 'done' ? 'bg-success' :
                                step.status === 'running' ? 'animate-pulse bg-accent' :
                                step.status === 'error' ? 'bg-danger' : 'bg-fg-muted'
                              )} />
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-[11px] font-semibold',
                                step.type === 'create' ? 'bg-success-subtle text-success-text' :
                                step.type === 'edit' ? 'bg-info-subtle text-info-text' :
                                step.type === 'delete' ? 'bg-danger-subtle text-danger-text' :
                                'bg-accent-subtle text-accent-text'
                              )}>
                                {step.type === 'create' ? 'Create' : step.type === 'edit' ? 'Edit' : step.type === 'delete' ? 'Delete' : 'Run'}
                              </span>
                              <span className="flex-1 truncate font-mono text-[12px] text-fg">{step.filePath}</span>
                              <span className="text-[11px] text-fg-muted">
                                {step.status === 'done' ? '✓' : step.status === 'running' ? '...' : step.status === 'error' ? '✗' : ''}
                              </span>
                              <svg
                                width="10" height="10" viewBox="0 0 10 10" fill="none"
                                className={cn('ml-auto shrink-0 text-fg-muted transition-transform', expandedStep === `${msg.id}-${String(i)}` ? 'rotate-180' : '')}
                              >
                                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>
                            {/* Step description */}
                            <div className="px-3 py-2">
                              <p className="text-xs leading-relaxed text-fg-muted">{step.description}</p>
                            </div>
                            {expandedStep === `${msg.id}-${String(i)}` && (
                              <div className="max-h-[300px] overflow-x-auto overflow-y-auto border-t border-border-subtle px-3 py-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
                                <FileContentPreview filePath={step.filePath} type={step.type} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Terminal command card */}
                    {msg.terminalCommand !== undefined && msg.terminalCommand !== '' && (
                      <div className="overflow-hidden rounded-lg border border-border-subtle bg-inset">
                        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                          <span className="size-[6px] rounded-full bg-success" />
                          <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[11px] font-semibold text-success-text">Bash</span>
                          <span className="flex-1 truncate font-mono text-[11px] text-fg-muted">{msg.terminalCommand}</span>
                        </div>
                        <div className="px-3 py-2">
                          <div className="flex gap-3">
                            <span className="shrink-0 text-[10px] font-semibold text-fg-muted">IN</span>
                            <code className="font-mono text-[11px] text-success-text">{msg.terminalCommand}</code>
                          </div>
                          {msg.terminalOutput !== undefined && msg.terminalOutput !== '' && (
                            <div className="flex gap-3 mt-1">
                              <span className="shrink-0 text-[10px] font-semibold text-fg-muted">OUT</span>
                              <code className="font-mono text-[11px] text-fg-muted whitespace-pre-wrap">{msg.terminalOutput.slice(0, 500)}</code>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Chat/text response */}
                    {msg.content !== '' && (
                      <div className="text-[13px] text-fg">
                        {/^\d+ files? (?:written|repaired) successfully$/i.test(msg.content) ? (
                          <div className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-subtle px-3 py-2.5 text-success-text">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
                              <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="text-[12px] font-medium text-success-text">{msg.content.replace(/written successfully/i, 'updated successfully')}</span>
                          </div>
                        ) : msgIndex === messages.length - 1 ? (
                          <TypewriterText text={msg.content} />
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {msg.content}
                          </ReactMarkdown>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void copyToClipboard(msg.content)}
                            className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors', copied ? 'bg-success/15 text-success-text' : 'text-fg-muted hover:text-fg')}
                          >
                            {copied ? '✓ Copied!' : '📋 Copy'}
                          </button>
                          <span className="ml-auto text-[10px] text-fg-muted opacity-40">
                            ~{String(estimateTokens(msg.content))} tokens
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {(isRunning || pendingApprovalId !== null) && (
              <div className="mb-4 space-y-2">
                {/* Sidebar mode has no textual header status, so keep one concise progress line there. */}
                {sidebar && <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'size-[6px] shrink-0 rounded-full',
                    steps.length > 0 ? 'bg-success' : 'animate-pulse bg-accent'
                  )} />
                  <span className="text-[13px] text-fg-muted">
                    {pendingApprovalId !== null && !isApproving
                      ? 'Waiting for approval'
                      : steps.length > 0
                        ? `${String(steps.filter(s => s.status === 'done').length)}/${String(steps.length)} actions complete`
                      : mode === 'file'
                        ? '● Preparing files...'
                        : mode === 'repair'
                          ? '● Reading and analyzing...'
                          : mode === 'review'
                            ? '● Reviewing code...'
                            : '● Thinking...'}
                  </span>
                </div>}

                {/* Live steps */}
                {steps.map(({ step, status }, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className={cn(
                      'size-[6px] shrink-0 rounded-full',
                      status === 'done' ? 'bg-success' :
                      status === 'running' ? 'animate-pulse bg-accent' :
                      status === 'error' ? 'bg-danger' : 'bg-fg-muted/30'
                    )} />
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                      step.type === 'delete' ? 'bg-danger-subtle text-danger-text' :
                      step.type === 'create' ? 'bg-success-subtle text-success-text' :
                      'bg-info-subtle text-info-text',
                    )}>
                      {step.type}
                    </span>
                    <span className={cn(
                      'text-[12px]',
                      status === 'done' ? 'text-success-text' :
                      status === 'running' ? 'text-fg font-medium' :
                      'text-fg-muted/50'
                    )}>
                      {stepStatusLabel(status)}{' '}
                      <span className="max-w-[42%] truncate font-mono" title={step.filePath}>{step.filePath}</span>
                    </span>
                    <span className="hidden max-w-[38%] truncate text-[11px] text-fg-muted md:inline" title={step.description}>
                      {step.description}
                    </span>
                    {status === 'done' && (
                      <span className="text-[11px] text-success-text">✓</span>
                    )}
                    {status === 'running' && (
                      <span className="ml-auto text-[10px] animate-pulse text-fg-muted">in progress…</span>
                    )}
                  </div>
                ))}

                {pendingApprovalId !== null && (
                  <div className="mt-3 rounded-xl border border-accent-border bg-raised px-3 py-3 shadow-sm">
                    {(() => {
                      const counts = actionCounts(steps.map(({ step }) => step));
                      const summary = [
                        counts.create > 0 ? `${String(counts.create)} create${counts.create === 1 ? '' : 's'}` : '',
                        counts.edit > 0 ? `${String(counts.edit)} edit${counts.edit === 1 ? '' : 's'}` : '',
                        counts.delete > 0 ? `${String(counts.delete)} delete${counts.delete === 1 ? '' : 's'}` : '',
                      ].filter(Boolean).join(' · ');
                      return (
                        <>
                          <p className="mb-1 text-[12px] font-semibold text-fg">{steps.length} {steps.length === 1 ? 'change' : 'changes'} ready for review</p>
                          <p className="mb-2.5 text-xs text-fg-muted">{summary}. Nothing changes until you apply.</p>
                        </>
                      );
                    })()}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isApproving}
                        onClick={() => { void approvePendingPlan(); }}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isApproving ? 'Applying…' : 'Apply changes'}
                      </button>
                      <button
                        type="button"
                        disabled={isApproving}
                        onClick={() => { void rejectPendingPlan(); }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Streaming text preview */}
                <ZapprStreamingPreview scrollRef={responseRef} />
              </div>
            )}

            {outcome !== null && outcome.kind !== 'success' && !isRunning && pendingApprovalId === null && (
              <div className={cn(
                'mb-4 rounded-lg border px-3 py-2.5 text-[12px]',
                outcome.kind === 'rollback-incomplete' || outcome.kind === 'error' ? 'border-danger/30 bg-danger/10 text-danger-text' :
                outcome.kind === 'reverted' ? 'border-warn-border bg-warn-subtle text-warn-text' :
                'border-border-subtle bg-hover text-fg-muted',
              )}>
                <span>{outcome.message}</span>
              </div>
            )}

            {/* Error */}
            {error !== null && (
              <div className="mb-4 rounded-lg border border-danger-border bg-danger-subtle px-3 py-2 text-[12px] text-danger-text">
                <span>⚠ {error}</span>
                <button type="button" onClick={() => { clearError(); setPrompt(''); }} className="ml-2 underline">Try again</button>
              </div>
            )}

            {/* Action cards */}
            {lastKeyUpdateProvider !== null && (
              <div className="mb-4 rounded-lg border border-success-border bg-success-subtle px-3 py-2">
                <p className="text-xs font-medium text-success-text">✓ API key saved — {lastKeyUpdateProvider}</p>
              </div>
            )}

            {lastShortcutCreated !== null && (
              <div className={cn('mb-4 rounded-lg border px-3 py-2', lastShortcutCreated.unresolved ? 'border-warn-border bg-warn-subtle' : 'border-success-border bg-success-subtle')}>
                <p className={cn('font-mono text-xs font-medium', lastShortcutCreated.unresolved ? 'text-warn-text' : 'text-success-text')}>
                  ✓ [{lastShortcutCreated.keys}] → {lastShortcutCreated.description}
                </p>
              </div>
            )}

            {lastTerminalCommand !== null && (
              <div className="mb-4 overflow-hidden rounded-lg border border-border-subtle bg-inset">
                <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                  <span className="size-[6px] rounded-full bg-success" />
                  <span className="rounded bg-success-subtle px-1.5 py-0.5 text-[11px] font-semibold text-success-text">Bash</span>
                  <span className="font-mono text-[11px] text-fg-muted">{lastTerminalCommand}</span>
                </div>
                <div className="px-3 py-2 space-y-1">
                  <div className="flex gap-3">
                    <span className="shrink-0 text-[10px] font-semibold text-fg-muted">IN</span>
                    <code className="font-mono text-[11px] text-success-text">{lastTerminalCommand}</code>
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
            <div className="h-4" />
          </div>

        {currentFilePath !== null && (
          <div className="border-t border-border-subtle px-3 py-2">
            <p className="mb-1 font-mono text-[10px] text-fg-muted">Writing: {currentFilePath}</p>
            <div className="relative max-h-[200px] overflow-hidden rounded-lg border border-border-subtle bg-inset p-2">
              <pre className="animate-pulse overflow-hidden font-mono text-[11px] leading-relaxed text-success-text">
                {currentFileContent?.slice(0, 500)}
                {(currentFileContent?.length ?? 0) > 500 ? '...' : ''}
              </pre>
              <span className="ml-0.5 inline-block h-3 w-2 animate-pulse bg-success" />
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

        {!isRunning && plan === null && selectedCode !== null && selectionIsCurrent && (
          <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-accent-border bg-accent-subtle">
            <div className="flex items-center justify-between border-b border-accent-border px-3 py-1.5">
              <span className="text-[11px] font-medium text-accent-text">
                Selected: {selectedCodeFile ?? 'current file'}
                <span className="ml-1 opacity-50">· lines {selectedCodeStartLine ?? 1}–{selectedCodeEndLine ?? selectedCode.split('\n').length}</span>
              </span>
              <button
                type="button"
                onClick={clearSelectedCode}
                aria-label="Clear selected code"
                className="text-[11px] text-fg-muted transition-colors hover:text-fg"
              >✕</button>
            </div>
            <pre className="max-h-[60px] overflow-hidden px-3 py-1.5 font-mono text-[11px] text-fg-muted opacity-70">
              {selectedCode.slice(0, 150)}{selectedCode.length > 150 ? '...' : ''}
            </pre>
            {/* Quick actions */}
            <div className="flex gap-1 border-t border-accent-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => {
                  void runSelectionAction('Explain this selected code clearly. Focus on behavior, important logic, and potential concerns.');
                }}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-accent-text transition-colors hover:bg-hover"
              >
                Explain
              </button>
              <button
                type="button"
                onClick={() => {
                  void runSelectionAction('Fix problems in this selected code while preserving intended behavior.');
                }}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                Fix
              </button>
              <button
                type="button"
                onClick={() => {
                  void runSelectionAction('Improve or add TypeScript types for this selected code without unnecessary refactoring.');
                }}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                Add Types
              </button>
              <button
                type="button"
                onClick={() => {
                  void runSelectionAction("Generate focused tests for this selected code using the project's existing test conventions.");
                }}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                Test
              </button>
            </div>
          </div>
        )}

        {!isRunning && plan === null && sidebar && (
          <div className="shrink-0 border-t border-border-subtle px-4 py-3">
            {(activeFallbackFile !== null || visibleMentionFiles.length > 0 || smartContextIndex.length > 0 || autoContextFiles.length > 0) && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="File context">
                {workspaceRoot !== null && smartContextIndex.length > 0 && (
                  <SmartContextIndicator
                    enabled={smartContextEnabled}
                    files={autoContextFiles}
                    onToggle={() => {
                      setSmartContextEnabled((enabled) => !enabled);
                      setAutoContextFiles([]);
                    }}
                  />
                )}
                {activeFallbackFile !== null && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-subtle bg-inset px-1.5 py-1 text-[11px] text-fg-muted" title="Current active file context">
                    <span className="text-fg">Active:</span>
                    <span className="max-w-[220px] truncate font-mono">{activeFallbackFile}</span>
                  </span>
                )}
                {visibleMentionFiles.length > 0 && <span className="text-[11px] text-fg-muted">Context:</span>}
                {visibleMentionFiles.slice(0, 4).map((file) => (
                  <span key={file} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-subtle bg-inset px-1.5 py-1 text-[11px] text-fg-muted">
                    <span className="max-w-[180px] truncate font-mono" title={file}>{file}</span>
                    <button type="button" aria-label={`Remove ${file} from context`} onClick={() => { removeMention(file); }} className="rounded text-fg-muted hover:text-fg">×</button>
                  </span>
                ))}
                {visibleMentionFiles.length > 4 && (
                  <span className="text-[11px] text-fg-muted">+{visibleMentionFiles.length - 4} more</span>
                )}
              </div>
            )}
            {mentionWarning !== null && <p role="status" className="mb-1 text-[11px] text-warn-text">{mentionWarning}</p>}
            {atSuggestions.length > 0 && atQuery !== null && (
              <div role="listbox" aria-label="Workspace files" className="mb-1 overflow-hidden rounded-lg border border-border-subtle bg-raised shadow-lg">
                {atSuggestions.map((file, index) => (
                  <button
                    key={file}
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestion}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      chooseMention(file);
                    }}
                    className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors', index === activeSuggestion ? 'bg-hover' : 'hover:bg-hover')}
                  >
                    <span className="font-mono text-accent-text text-xs">@</span>
                    <span className="flex-1 truncate font-mono text-xs text-fg">{file}</span>
                    <span className="shrink-0 text-[11px] text-fg-muted">{file.split('.').pop()}</span>
                  </button>
                ))}
              </div>
            )}
              <div className="flex items-start gap-2.5 rounded-xl border border-border-strong bg-inset px-3 py-2.5 focus-within:border-accent-border">
              <span className="mt-[3px] shrink-0 text-[12px] font-mono text-fg-muted">{'>'}</span>
              <textarea
                ref={promptInputRef}
                data-zappr-input
                value={prompt}
                onChange={(e) => {
                  const val = e.target.value;
                  setPrompt(val);
                  setAutoContextFiles([]);

                  // Detect @ mention
                  const caret = e.currentTarget.selectionStart;
                  const beforeCaret = val.slice(0, caret);
                  const match = /(?:^|\s)@([\w./-]*)$/.exec(beforeCaret);
                  if (match !== null) {
                    const query = match[1] ?? '';
                    setAtQuery(query);
                    const filtered = searchMentionFiles(mentionFileIndex, query);
                    setAtSuggestions(filtered);
                    setActiveSuggestion(0);
                  } else {
                    setAtQuery(null);
                    setAtSuggestions([]);
                  }
                }}
                onKeyDown={(e) => {
                  if (atSuggestions.length > 0 && e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveSuggestion((index) => (index + 1) % atSuggestions.length);
                    return;
                  }
                  if (atSuggestions.length > 0 && e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveSuggestion((index) => (index - 1 + atSuggestions.length) % atSuggestions.length);
                    return;
                  }
                  if (atSuggestions.length > 0 && e.key === 'Escape') {
                    e.preventDefault();
                    setAtSuggestions([]);
                    setAtQuery(null);
                    return;
                  }
                  if (atSuggestions.length > 0 && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const choice = atSuggestions[activeSuggestion];
                    if (choice !== undefined) chooseMention(choice);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim() !== '') void runWithMentionContext();
                  }
                }}
                placeholder="Ask anything about your code..."
                className="min-h-[20px] max-h-[120px] min-w-0 flex-1 resize-none bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
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
                onClick={() => void runWithMentionContext()}
                disabled={prompt.trim() === '' || isRunning}
                aria-label="Send to Zappr"
                className="mt-0.5 shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-30"
              >
                ↵
              </button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-fg-muted">Enter to send · Shift+Enter new line</p>
          </div>
        )}

        {!isRunning && plan === null && !sidebar && (
          <div className="shrink-0 px-3 py-2.5">
            <textarea
              ref={promptInputRef}
              data-zappr-input
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setAutoContextFiles([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim() !== '') void runWithMentionContext();
                }
                // Shift+Enter = new line (default textarea behavior)
              }}
              placeholder='Try "Create a login page with React" or "Add dark mode toggle"'
              className="min-h-[60px] max-h-[150px] w-full min-w-0 resize-none rounded-xl border border-border-strong bg-inset p-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-focus-ring focus:border-accent-border sm:p-4"
              autoFocus
            />
          </div>
        )}

        {!isRunning && plan === null && !sidebar && (
          <div className="mt-2 flex shrink-0 items-center gap-2 px-4 pb-3">
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
              {workspaceRoot !== null && smartContextIndex.length > 0 && (
                <SmartContextIndicator
                  enabled={smartContextEnabled}
                  files={autoContextFiles}
                  onToggle={() => {
                    setSmartContextEnabled((enabled) => !enabled);
                    setAutoContextFiles([]);
                  }}
                />
              )}
              {activeFile !== null && (
                <div
                  className="flex min-w-0 items-center gap-1 rounded-[5px] border border-border-subtle bg-inset px-2 py-1 text-[11px] text-fg-muted"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1h6M1 4h4M1 7h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                  <span className="min-w-0 truncate">{activeFile.split('/').pop() ?? activeFile}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void runWithMentionContext()}
              disabled={prompt.trim() === ''}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-[7px] text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              ⚡ Zap
            </button>
          </div>
        )}
        </div>
      </div>
  );
}

function FileContentPreview({ filePath, type }: { filePath: string; type: string }): React.JSX.Element {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (workspace === null) return;
    invoke('fs:readFile', { relPath: filePath })
      .then((result) => {
        if (result.ok) setContent(result.value.file.content);
      })
      .catch(() => null);
  }, [filePath, workspace]);

  if (type === 'delete') {
    return <span className="text-[11px] text-danger-text">File deleted</span>;
  }

  if (content === null) {
    return <span className="text-fg-muted opacity-50 text-[11px]">Loading...</span>;
  }

  const lines = content.slice(0, 3000).split('\n');
  const isCreate = type === 'create';

  return (
    <div className="space-y-0">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 rounded px-1 hover:bg-hover">
          <span className="shrink-0 w-6 text-right text-[10px] text-fg-muted opacity-30 select-none">
            {String(i + 1)}
          </span>
          {isCreate && (
            <span className="shrink-0 text-[11px] text-success-text select-none">+</span>
          )}
          <span className={cn(
            'flex-1 font-mono text-[11px] whitespace-pre-wrap break-all',
            isCreate ? 'text-success-text' : 'text-fg-muted'
          )}>
            {line || ' '}
          </span>
        </div>
      ))}
      {content.length > 3000 && (
        <p className="text-[10px] text-fg-muted opacity-40 px-1 pt-1">... truncated</p>
      )}
    </div>
  );
}

function TypewriterText({ text, speed = 8 }: { text: string; speed?: number }): React.JSX.Element {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollable = containerRef.current?.closest('[data-zappr-scroll]');
    if (scrollable instanceof HTMLElement) {
      scrollable.scrollTop = scrollable.scrollHeight;
    }
  }, [displayed]);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (text === '') return;

    let i = 0;
    const timer = setInterval(() => {
      i += speed;
      if (i >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(timer);
      } else {
        setDisplayed(text.slice(0, i));
      }
    }, 16);
    return () => { clearInterval(timer); };
  }, [text, speed]);

  return (
    <div ref={containerRef}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
        {displayed}
      </ReactMarkdown>
      {!done && <span className="inline-block h-3 w-[2px] animate-pulse bg-accent align-middle ml-0.5" />}
    </div>
  );
}
