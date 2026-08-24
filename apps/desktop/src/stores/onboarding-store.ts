import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The first-launch walkthrough (5 steps, `onboarding-modal.tsx`). Persisted so it shows exactly
 * once per install — a returning user who already knows the app must never see it again.
 */
const LAST_STEP = 4;

type OnboardingState = {
  hasSeenOnboarding: boolean;
  currentStep: number;
  nextStep: () => void;
  skipOnboarding: () => void;
  completeOnboarding: () => void;
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      hasSeenOnboarding: false,
      currentStep: 0,

      nextStep: () => {
        const step = get().currentStep;
        if (step >= LAST_STEP) {
          set({ hasSeenOnboarding: true });
        } else {
          set({ currentStep: step + 1 });
        }
      },
      skipOnboarding: () => {
        set({ hasSeenOnboarding: true });
      },
      completeOnboarding: () => {
        set({ hasSeenOnboarding: true });
      },
    }),
    {
      name: 'fixora.onboarding',
      partialize: (s) => ({ hasSeenOnboarding: s.hasSeenOnboarding }),
      merge: (persisted, current) => ({
        ...current,
        hasSeenOnboarding: (persisted as Partial<OnboardingState> | null)?.hasSeenOnboarding === true,
      }),
    },
  ),
);
