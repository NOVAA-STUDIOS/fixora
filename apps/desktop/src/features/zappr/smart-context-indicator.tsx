import type { SmartContextCandidate } from './smart-project-context.js';

export function SmartContextIndicator({
  enabled,
  files,
  onToggle,
  showToggle = true,
}: {
  enabled: boolean;
  files: readonly SmartContextCandidate[];
  onToggle: (() => void) | null;
  showToggle?: boolean;
}): React.JSX.Element {
  const title = files.map((file) => `${file.path} (${file.reason})`).join('\n');
  return (
    <>
      {showToggle && onToggle !== null && (
        <button
          type="button"
          aria-pressed={enabled}
          onClick={onToggle}
          className="inline-flex items-center rounded-md border border-border-subtle px-1.5 py-1 text-[10px] text-fg-muted hover:bg-hover"
          title="Automatically include up to four relevant workspace files for this prompt"
        >
          Smart context: {enabled ? 'On' : 'Off'}
        </button>
      )}
      {files.length > 0 && (
        <span
          aria-label={`Automatic project context: ${String(files.length)} ${files.length === 1 ? 'file' : 'files'}`}
          className="inline-flex items-center rounded-md border border-border-subtle bg-hover px-1.5 py-1 text-[10px] text-fg-muted"
          title={title}
        >
          Auto context: {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
      )}
    </>
  );
}
