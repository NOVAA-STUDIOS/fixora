import type * as monaco from 'monaco-editor';

import { computeHunks, type Hunk } from './inline-diff.js';

/**
 * The inline repair review surface — the editor half of the editor-first workflow.
 *
 * A proposed repair is now reviewed where the code lives, the way VS Code, Cursor and Copilot present
 * an edit: the affected lines are marked in place, the proposed replacement is rendered directly
 * beneath them, and the accept/reject controls sit on the change rather than in a side panel. The AI
 * panel keeps the reasoning — root cause, verification, impact — and no longer competes with the
 * editor for the job of showing code.
 *
 * ## What this does NOT do
 *
 * It renders and it navigates. It does not decide anything. Accept calls the SAME `applyRepair()` the
 * panel's button called, which goes through the same guarded `ai:applyRepair` channel with the same
 * staleness check; reject calls the same `dismiss()`. Whether Accept is even offered is decided by
 * the caller from `evaluateApplyGate`, unchanged. No repair logic, no verification, no regression
 * detection and no prompt is touched by anything in this file — it is a view over a decision that has
 * already been made elsewhere.
 *
 * Monaco resources (decorations, view zones, widgets) are all owned by the returned handle and
 * released by `dispose()`. They are attached to the editor, never to a model the cache owns, so
 * tearing this down cannot orphan a model or a worker request.
 */

export interface InlineRepairView {
  /** Move the viewport to a hunk by index, wrapping at both ends. Returns the index landed on. */
  goTo(index: number): number;
  next(): number;
  previous(): number;
  readonly hunkCount: number;
  dispose(): void;
}

export interface InlineRepairOptions {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly monacoApi: typeof monaco;
  /** The slice the repair replaces, and its proposed replacement. */
  readonly originalCode: string;
  readonly repairedCode: string;
  /** 1-based inclusive file range the slice occupies. */
  readonly startLine: number;
  readonly endLine: number;
  /** Called when the user moves between hunks, so the host can mirror the position in its header. */
  readonly onActiveHunkChange?: (index: number, total: number) => void;
}

/** Rendered above each replaced region: the proposed lines, styled as an addition. */
function addedLinesNode(hunk: Hunk, fontFamily: string, fontSize: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fx-inline-added';
  wrap.style.fontFamily = fontFamily;
  wrap.style.fontSize = `${String(fontSize)}px`;
  for (const line of hunk.added) {
    const row = document.createElement('div');
    row.className = 'fx-inline-added-line';
    // textContent, never innerHTML: this is model output being rendered into the editor's DOM, and
    // it must never be able to introduce markup.
    row.textContent = line === '' ? ' ' : line;
    wrap.appendChild(row);
  }
  return wrap;
}

export function mountInlineRepair(options: InlineRepairOptions): InlineRepairView {
  const { editor, monacoApi, originalCode, repairedCode, startLine, endLine } = options;
  const hunks = computeHunks(originalCode, repairedCode, startLine);

  const fontFamily = editor.getOption(monacoApi.editor.EditorOption.fontFamily);
  const fontSize = editor.getOption(monacoApi.editor.EditorOption.fontSize) || 13;

  /**
   * The whole target range is tinted, and each replaced line is marked individually.
   *
   * The range tint is what tells the user "this region is under review" even when they have scrolled
   * to a part of it with no changes — a repair that rewrites a method touches lines it does not
   * change, and leaving those unmarked makes the review area ambiguous.
   */
  const decorations = editor.createDecorationsCollection([
    {
      range: new monacoApi.Range(startLine, 1, endLine, 1),
      options: {
        isWholeLine: true,
        className: 'fx-inline-scope',
        linesDecorationsClassName: 'fx-inline-scope-gutter',
      },
    },
    ...hunks
      .filter((h) => h.removedCount > 0)
      .map((h) => ({
        range: new monacoApi.Range(h.startLine, 1, h.startLine + h.removedCount - 1, 1),
        options: {
          isWholeLine: true,
          className: 'fx-inline-removed',
          linesDecorationsClassName: 'fx-inline-removed-gutter',
        },
      })),
  ]);

  // The proposed replacement, rendered beneath each region it replaces.
  const zoneIds: string[] = [];
  editor.changeViewZones((accessor) => {
    for (const hunk of hunks) {
      if (hunk.added.length === 0) continue;
      const domNode = addedLinesNode(hunk, fontFamily, fontSize);
      zoneIds.push(
        accessor.addZone({
          // `afterLineNumber` is the line the zone sits below. For a pure insertion the hunk starts
          // at the line it inserts BEFORE, so the zone goes above that line, i.e. after the previous.
          afterLineNumber:
            hunk.removedCount === 0 ? hunk.startLine - 1 : hunk.startLine + hunk.removedCount - 1,
          heightInLines: hunk.added.length,
          domNode,
        }),
      );
    }
  });

  let active = 0;
  const reveal = (index: number): number => {
    if (hunks.length === 0) return 0;
    const wrapped = ((index % hunks.length) + hunks.length) % hunks.length;
    active = wrapped;
    const hunk = hunks[wrapped];
    if (hunk !== undefined) {
      editor.revealRangeInCenterIfOutsideViewport(
        new monacoApi.Range(hunk.startLine, 1, hunk.startLine + Math.max(hunk.removedCount, 1) - 1, 1),
        monacoApi.editor.ScrollType.Smooth,
      );
      editor.setPosition({ lineNumber: hunk.startLine, column: 1 });
    }
    options.onActiveHunkChange?.(wrapped, hunks.length);
    return wrapped;
  };

  // Land on the first change immediately: the point of an inline review is that the change is on
  // screen without the user hunting for it.
  if (hunks.length > 0) reveal(0);

  return {
    hunkCount: hunks.length,
    goTo: reveal,
    next: () => reveal(active + 1),
    previous: () => reveal(active - 1),
    dispose: () => {
      decorations.clear();
      editor.changeViewZones((accessor) => {
        for (const id of zoneIds) accessor.removeZone(id);
      });
      zoneIds.length = 0;
    },
  };
}
