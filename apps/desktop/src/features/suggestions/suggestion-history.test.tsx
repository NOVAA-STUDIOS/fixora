import type { Suggestion } from '@fixora/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuggestionHistory } from './suggestion-history.js';

const suggestions: Suggestion[] = [
  { id: '1', category: 'feature', message: 'Add dark mode', createdAt: Date.now() },
  { id: '2', category: 'bug', message: 'Crash on save', createdAt: Date.now() - 1000 },
];

function renderHistory(overrides: Partial<React.ComponentProps<typeof SuggestionHistory>> = {}) {
  const props = {
    suggestions,
    loaded: true,
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onExport: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  };
  render(<SuggestionHistory {...props} />);
  return props;
}

describe('SuggestionHistory', () => {
  it('shows a loading skeleton before the list has loaded', () => {
    const { container } = render(
      <SuggestionHistory
        suggestions={[]}
        loaded={false}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onExport={vi.fn()}
        onShare={vi.fn()}
      />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an empty state once loaded with nothing submitted', () => {
    renderHistory({ suggestions: [] });
    expect(screen.getByText(/nothing submitted yet/i)).toBeTruthy();
  });

  it('lists every suggestion with its category and message', () => {
    renderHistory();
    expect(screen.getByText('Add dark mode')).toBeTruthy();
    expect(screen.getByText('Crash on save')).toBeTruthy();
    expect(screen.getByText('Feature request')).toBeTruthy();
    expect(screen.getByText('Bug report')).toBeTruthy();
  });

  it('removes one entry via its delete button', () => {
    const { onRemove } = renderHistory();
    fireEvent.click(screen.getAllByLabelText('Delete this suggestion')[0]!);
    expect(onRemove).toHaveBeenCalledWith('1');
  });

  it('clear all asks for confirmation before calling onClear', () => {
    const { onClear } = renderHistory();
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClear).not.toHaveBeenCalled(); // not yet — the confirm dialog hasn't been confirmed
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('export is one click, no confirmation needed', () => {
    const { onExport } = renderHistory();
    fireEvent.click(screen.getByRole('button', { name: /export json/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('every row offers a one-click Email to Fixora action, no confirmation needed', () => {
    const { onShare } = renderHistory();
    const shareButtons = screen.getAllByRole('button', { name: /email to fixora/i });
    expect(shareButtons).toHaveLength(2); // one per suggestion

    fireEvent.click(shareButtons[0]!);
    expect(onShare).toHaveBeenCalledWith('1');
    expect(onShare).toHaveBeenCalledTimes(1);

    fireEvent.click(shareButtons[1]!);
    expect(onShare).toHaveBeenCalledWith('2');
  });
});
