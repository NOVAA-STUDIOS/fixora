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
});

describe('EditModeTabs', () => {
  it('offers Repair, Proceed, and a disabled Explain placeholder', () => {
    const onChange = vi.fn();
    render(<EditModeTabs active="proceed" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Repair' })).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Proceed');
    const explain = screen.getByRole('tab', { name: /Explain/ });
    expect(explain.hasAttribute('disabled')).toBe(true);
  });

  it('switches mode on click', () => {
    const onChange = vi.fn();
    render(<EditModeTabs active="proceed" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Repair' }));
    expect(onChange).toHaveBeenCalledWith('repair');
  });
});
