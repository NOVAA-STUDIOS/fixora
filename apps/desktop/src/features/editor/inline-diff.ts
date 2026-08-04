/**
 * Line-level hunks between the original slice and the proposed replacement.
 *
 * Pure, and deliberately so: this is the only new logic the inline-review surface needs, and keeping
 * it free of Monaco means it can be unit-tested directly rather than through a mounted editor. It
 * computes nothing about *whether* a repair is good — that is the verifier's job and is untouched —
 * only where the proposed text differs from what is there now, so the editor can decorate those
 * regions and let the user step between them.
 *
 * The algorithm is a standard LCS over lines. Line diffs are what an IDE shows, and a character-level
 * diff would produce hunks too small to navigate between.
 */

export interface Hunk {
  /**
   * 1-based inclusive lines in the CURRENT file that this hunk replaces. `removedCount === 0` means
   * a pure insertion, and then `startLine` is the line the new text is inserted BEFORE.
   */
  readonly startLine: number;
  readonly removedCount: number;
  /** The replacement lines for this hunk. Empty means a pure deletion. */
  readonly added: readonly string[];
}

const SPLIT_EOL = /\r?\n/;

/** Longest common subsequence of two line arrays, as a table of match lengths. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i];
      const next = table[i + 1];
      if (row === undefined || next === undefined) continue;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

/**
 * The hunks that turn `original` into `replacement`, in file coordinates.
 *
 * `baseLine` is the 1-based file line the original slice starts at, so the returned hunks address
 * real lines in the open document rather than offsets into a fragment.
 */
export function computeHunks(
  original: string,
  replacement: string,
  baseLine: number,
): readonly Hunk[] {
  const a = original.split(SPLIT_EOL);
  const b = replacement.split(SPLIT_EOL);
  const table = lcsTable(a, b);

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  // A run of removals and/or additions is accumulated and flushed as ONE hunk when the walk reaches
  // the next common line. Emitting each changed line separately would make a reindented block into a
  // dozen hunks to step through, which is noise rather than navigation.
  let pendingRemoved = 0;
  let pendingAdded: string[] = [];
  let pendingStart = baseLine;

  const flush = (): void => {
    if (pendingRemoved === 0 && pendingAdded.length === 0) return;
    hunks.push({ startLine: pendingStart, removedCount: pendingRemoved, added: [...pendingAdded] });
    pendingRemoved = 0;
    pendingAdded = [];
  };

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
      pendingStart = baseLine + i;
      continue;
    }
    if (pendingRemoved === 0 && pendingAdded.length === 0) pendingStart = baseLine + i;
    const down = table[i + 1]?.[j] ?? 0;
    const right = table[i]?.[j + 1] ?? 0;
    if (down >= right) {
      pendingRemoved += 1;
      i += 1;
    } else {
      pendingAdded.push(b[j] ?? '');
      j += 1;
    }
  }
  if (i < a.length || j < b.length) {
    if (pendingRemoved === 0 && pendingAdded.length === 0) pendingStart = baseLine + i;
    pendingRemoved += a.length - i;
    for (; j < b.length; j++) pendingAdded.push(b[j] ?? '');
  }
  flush();
  return hunks;
}

/** A one-line description of what a patch does, for the inline widget's header. */
export function describeHunks(hunks: readonly Hunk[]): string {
  if (hunks.length === 0) return 'No changes';
  const added = hunks.reduce((n, h) => n + h.added.length, 0);
  const removed = hunks.reduce((n, h) => n + h.removedCount, 0);
  const parts: string[] = [];
  if (added > 0) parts.push(`+${String(added)}`);
  if (removed > 0) parts.push(`−${String(removed)}`);
  const edits = `${String(hunks.length)} ${hunks.length === 1 ? 'edit' : 'edits'}`;
  return parts.length === 0 ? edits : `${edits} · ${parts.join(' ')}`;
}
