import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useOnboardingStore } from '../../stores/onboarding-store.js';

import { OnboardingModal } from './onboarding-modal.js';

beforeEach(() => {
  useOnboardingStore.setState({ hasSeenOnboarding: false, currentStep: 0 });
});

describe('OnboardingModal', () => {
  it('presents Fixora identity and the existing five-step tour with themed visuals', async () => {
    const user = userEvent.setup();
    render(<OnboardingModal />);

    expect(screen.getByRole('heading', { name: 'Welcome to Fixora' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Fixora' })).toBeTruthy();

    for (const [index, heading] of [
      'Open Your Project',
      'Analyze Your Code',
      'Fix with AI',
      "You're Ready!",
    ].entries()) {
      await user.click(screen.getByRole('button', { name: index === 0 ? 'Get Started' : 'Next' }));
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }

    expect(screen.getByRole('button', { name: 'Start Using Fixora' })).toBeTruthy();
  });
});
