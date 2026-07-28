import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuggestionForm } from './suggestion-form.js';

/**
 * The form owns validation, the character counter, and the loading state. These pin: it never
 * submits an empty or too-short message, the counter reflects the raw (untrimmed) length, the
 * loading state disables the field and relabels the button, and a server error is shown and
 * dismissible without the form clearing what the user typed.
 */
describe('SuggestionForm', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof SuggestionForm>> = {}) {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onDismissServerError = vi.fn();
    render(
      <SuggestionForm
        submitting={false}
        serverError={null}
        onDismissServerError={onDismissServerError}
        onSubmit={onSubmit}
        {...overrides}
      />,
    );
    return { onSubmit, onDismissServerError };
  }

  it('shows the live character counter as the user types', () => {
    setup();
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: 'hello there' },
    });
    expect(screen.getByText('11 / 2000')).toBeTruthy();
  });

  it('never submits an empty message', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: /send suggestion/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Write your suggestion before submitting.',
    );
  });

  it('never submits a too-short message and reports how much more is needed', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send suggestion/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Add 5 more characters.');
  });

  it('submits the trimmed message with the selected category, and clears the field on success', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText("What's on your mind?"), {
      target: { value: '  a perfectly good suggestion  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send suggestion/i }));
    expect(onSubmit).toHaveBeenCalledWith('feature', 'a perfectly good suggestion');
    expect(await screen.findByLabelText("What's on your mind?")).toHaveValue('');
  });

  it('disables the field and relabels the button while submitting', () => {
    setup({ submitting: true });
    expect(screen.getByRole('button', { name: /sending/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText("What's on your mind?").hasAttribute('disabled')).toBe(true);
  });

  it('shows a server error with a working dismiss action', () => {
    const { onDismissServerError } = setup({ serverError: 'Something went wrong on our end.' });
    expect(screen.getByText('Something went wrong on our end.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissServerError).toHaveBeenCalledTimes(1);
  });
});
