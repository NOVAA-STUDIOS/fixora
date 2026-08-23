import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditModeTabs, ProceedPanel } from './proceed-panel.js';

/**
 * The Proceed tab is minimal, so its tests are minimal: it collects an instruction and submits it,
 * never submits an empty one, and the mode switch offers Repair / Proceed / Explain with Explain a
 * disabled placeholder. This pins that the UI surface exists and behaves, without touching Repair.
 */

describe('ProceedPanel', () => {
  it('renders the prompt and submits the trimmed instruction', () => {
    const onSubmit = vi.fn();
    render(<ProceedPanel onSubmit={onSubmit} />);
    expect(screen.getByText('What would you like to change?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: '  make this button green  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    expect(onSubmit).toHaveBeenCalledWith('make this button green');
  });

  it('never submits an empty or whitespace-only instruction', () => {
    const onSubmit = vi.fn();
    render(<ProceedPanel onSubmit={onSubmit} />);
    const button = screen.getByRole('button', { name: 'Proceed' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('What would you like to change?'), {
      target: { value: '   ' },
    });
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables input and submit while busy', () => {
    render(<ProceedPanel onSubmit={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: 'Working…' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers a real Cancel action while busy (Q3 Defect #4)', () => {
    const onCancel = vi.fn();
    render(<ProceedPanel onSubmit={vi.fn()} busy onCancel={onCancel} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render Cancel when idle (nothing running to cancel)', () => {
    render(<ProceedPanel onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('does not render Cancel while busy if no onCancel handler was given', () => {
    render(<ProceedPanel onSubmit={vi.fn()} busy />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('EditModeTabs', () => {
  it('offers Repair, Proceed, and Explain — all enabled', () => {
    const onChange = vi.fn();
    render(<EditModeTabs active="proceed" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Repair' })).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Proceed');
    // Explain shipped: the tab is live and no longer carries a "(soon)" placeholder label, which
    // is the user-visible half of the feature actually existing.
    const explain = screen.getByRole('tab', { name: 'Explain' });
    expect(explain.hasAttribute('disabled')).toBe(false);
    expect(explain.textContent).not.toContain('soon');
  });

  it('switches mode on click', () => {
    const onChange = vi.fn();
    render(<EditModeTabs active="proceed" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Repair' }));
    expect(onChange).toHaveBeenCalledWith('repair');
  });
});
