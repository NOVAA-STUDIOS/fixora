import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PanelGroupRoot, ResizablePanel, ResizeHandle } from './resizable.js';

/**
 * `Separator` renders no children and sets `flex-basis: auto` with no width or height of its own, so
 * a handle that does not declare its own thickness collapses to 0px: invisible, and impossible to
 * grab with a mouse. That is not something jsdom will show us — it computes no layout — so the guard
 * here is that the handle *declares* a thickness for its axis and a widened pointer target.
 *
 * These assertions are deliberately about the class contract rather than about pixels. They exist to
 * fail loudly if someone removes the sizing again while the component still "looks fine" in a test
 * environment that never lays it out.
 */
describe('ResizeHandle', () => {
  function renderHandle(orientation: 'horizontal' | 'vertical'): HTMLElement {
    render(
      <PanelGroupRoot orientation={orientation}>
        <ResizablePanel id="a" defaultSize="50" />
        <ResizeHandle aria-label="Resize" />
        <ResizablePanel id="b" defaultSize="50" />
      </PanelGroupRoot>,
    );
    return screen.getByRole('separator');
  }

  it('declares a thickness on both axes so it can never collapse to zero', () => {
    const handle = renderHandle('horizontal');
    // A horizontal group is divided by a *vertical* separator, so width is the axis that matters.
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle.className).toContain('aria-[orientation=vertical]:w-px');
    expect(handle.className).toContain('aria-[orientation=horizontal]:h-px');
  });

  it('widens the pointer target beyond the 1px line', () => {
    // A 1px grab target is a pixel-hunt. The line stays 1px; the hit area is an overlay around it.
    expect(renderHandle('horizontal').className).toContain('after:absolute');
  });

  it('paints the drag colour only while dragging', () => {
    // `data-separator` is present in every state, including idle, so a bare attribute selector
    // (`data-[separator]:`) left the divider permanently accent-coloured. Match by value.
    const handle = renderHandle('horizontal');
    expect(handle.className).toContain('data-[separator=active]:bg-accent');
    expect(handle.className).not.toContain('data-[separator]:bg-accent');
  });
});
