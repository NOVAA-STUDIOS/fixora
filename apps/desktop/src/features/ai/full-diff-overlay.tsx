import { Button } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { DiffEditor } from '../editor/diff-editor.js';

/**
 * The traditional side-by-side diff, on demand.
 *
 * Inline review in the editor is the default surface, but a side-by-side view is genuinely the right
 * tool for a large patch — a whole-file rewrite is easier to judge in two columns than as a sequence
 * of inline hunks. Rather than keep that view permanently mounted in the panel (where it crowded out
 * the reasoning and duplicated the editor), it is opened deliberately and dismissed when done.
 *
 * It mounts the SAME `DiffEditor` the panel used, unchanged. Nothing about diff rendering, the repair
 * pipeline, verification or Apply is different here — this is a container.
 */
export function FullDiffOverlay(): React.JSX.Element | null {
  const open = useUiStore((s) => s.fullDiffOpen);
  const close = useUiStore((s) => s.closeFullDiff);
  const proposal = useAiStore((s) => s.proposal);
  const [view, setView] = useState<'unified' | 'split'>('split');

  // Escape closes it, the way every modal in the app does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!open) return null;
  if (proposal?.profile !== 'repair') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full diff"
      className="fixed inset-0 z-50 flex flex-col bg-canvas/80 p-6 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-strong bg-raised shadow-2xl"
        // The backdrop closes; the panel itself must not, or every click inside dismisses it.
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
          <span className="text-sm font-semibold text-fg">Full diff</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-fg-secondary">
            {basename(proposal.target.file)}:{proposal.target.startLine}–{proposal.target.endLine}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5" role="group" aria-label="Diff view">
            {(
              [
                ['unified', 'Unified'],
                ['split', 'Side-by-side'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => {
                  setView(value);
                }}
                className={
                  view === value
                    ? 'rounded bg-inset px-1.5 py-0.5 text-[10px] text-fg ring-1 ring-border-strong ring-inset'
                    : 'rounded px-1.5 py-0.5 text-[10px] text-fg-muted hover:text-fg'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={close}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <DiffEditor
            original={proposal.originalCode}
            modified={proposal.repairedCode}
            language={monacoLanguageFor(proposal.target.file)}
            startLine={proposal.target.startLine}
            sideBySide={view === 'split'}
          />
        </div>
      </div>
    </div>
  );
}

const MONACO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
};

function monacoLanguageFor(file: string): string {
  return MONACO_LANG[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
}
