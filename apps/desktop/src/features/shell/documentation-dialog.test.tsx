import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DocumentationDialog } from './documentation-dialog.js';

describe('DocumentationDialog', () => {
  it('renders the condensed guide sections when open', () => {
    render(<DocumentationDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Documentation' })).toBeTruthy();
    expect(screen.getByText(/1\. Install/)).toBeTruthy();
    expect(screen.getByText(/7\. Your privacy/)).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    render(<DocumentationDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Documentation' })).toBeNull();
  });

  it('calls onOpenChange(false) on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<DocumentationDialog open onOpenChange={onOpenChange} />);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('never claims docs/USER-GUIDE.md is present on the user\'s machine (beta audit A1, finding 1)', () => {
    // The packaged installer never bundles `docs/` (electron-builder.yml ships only out/** and
    // package.json), so a claim naming that specific path would be false for every real install.
    render(<DocumentationDialog open onOpenChange={vi.fn()} />);
    expect(screen.queryByText(/docs\/USER-GUIDE\.md/)).toBeNull();
    expect(screen.queryByText(/ships alongside fixora/i)).toBeNull();
  });
});
