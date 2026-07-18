import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary.js';

/**
 * Before this existed, one uncaught render error unmounted the whole tree and left a blank window
 * with no way back. The renderer displays other people's source code and derives its panels from
 * external tool output, so that is a realistic failure, not a hypothetical one.
 */

function Boom({ explode }: { explode: boolean }): React.JSX.Element {
  if (explode) throw new Error('kaboom in the findings panel');
  return <p>panel content</p>;
}

beforeEach(() => {
  // React logs the caught error itself; silence it so a passing run is not full of red noise.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('panel content')).toBeTruthy();
  });

  it('catches a render error and offers a way forward instead of a blank screen', () => {
    render(
      <ErrorBoundary label="The findings panel">
        <Boom explode />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The findings panel stopped responding');
    // The message is shown so a bug report can carry it.
    expect(alert.textContent).toContain('kaboom in the findings panel');
    // And there is always somewhere to go from here.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload Fixora' })).toBeTruthy();
  });

  it('reassures the user that nothing was written to disk', () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    // A crash in a tool that edits your files should say, immediately, that it did not edit them.
    expect(screen.getByRole('alert').textContent).toContain('not touched');
  });

  it('recovers when the cause was transient', async () => {
    const user = userEvent.setup();

    // An external flag rather than a self-resetting component: React may render a failing child
    // more than once while handling the error, so "throws the first time" is not a stable notion.
    let broken = true;
    function Flaky(): React.JSX.Element {
      if (broken) throw new Error('transient');
      return <p>panel content</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    // The underlying cause clears, then the user retries — which is the real-world sequence.
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('panel content')).toBeTruthy();
  });
});
