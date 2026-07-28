import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SplashScreen } from './splash-screen.js';

/**
 * The loading indicator must reflect real work in progress (req. 5 of the splash-timing adjustment):
 * present while `working` is true, gone the instant it's false — even though the splash itself may
 * still be visible for the brief remainder of the entrance-animation floor (`use-splash.ts`).
 */
describe('SplashScreen', () => {
  it('shows the loading indicator while working', () => {
    const { container } = render(
      <SplashScreen
        phase="loading"
        message="Loading workspace…"
        working
        errorMessage={null}
        version={null}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[class*="fx-splash-sweep"]')).not.toBeNull();
    expect(screen.getByText('Loading workspace…')).toBeTruthy();
  });

  it('hides the loading indicator once work is done, even while still visible', () => {
    const { container } = render(
      <SplashScreen
        phase="loading"
        message="Ready"
        working={false}
        errorMessage={null}
        version={null}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[class*="fx-splash-sweep"]')).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('renders the version once fetched', () => {
    render(
      <SplashScreen
        phase="loading"
        message="Ready"
        working={false}
        errorMessage={null}
        version="0.9.0-beta.1"
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('v0.9.0-beta.1')).toBeTruthy();
  });

  it('shows the failure state with retry and continue actions, regardless of working', () => {
    render(
      <SplashScreen
        phase="error"
        message="Ready"
        working={false}
        errorMessage="Could not list the workspace."
        version={null}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Fixora could not start' })).toBeTruthy();
    expect(screen.getByText('Could not list the workspace.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeTruthy();
  });
});
