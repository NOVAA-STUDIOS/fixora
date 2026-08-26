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
  /** Settings → "Replay Onboarding Tour": shows the walkthrough again from step 0. */
  resetOnboarding: () => void;
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
      resetOnboarding: () => {
        set({ hasSeenOnboarding: false, currentStep: 0 });
      },
    }),
    {
      name: 'fixora.onboarding',
      partialize: (s) => ({ hasSeenOnboarding: s.hasSeenOnboarding, currentStep: s.currentStep }),
      merge: (persisted, current) => {
        const p = persisted as Partial<OnboardingState> | null;
        return {
          ...current,
          hasSeenOnboarding: p?.hasSeenOnboarding === true,
          currentStep:
            typeof p?.currentStep === 'number' &&
            Number.isFinite(p.currentStep) &&
            p.currentStep >= 0 &&
            p.currentStep <= LAST_STEP
              ? p.currentStep
              : 0,
        };
      },
    },
  ),
);
