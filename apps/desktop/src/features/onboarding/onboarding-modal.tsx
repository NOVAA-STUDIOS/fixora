import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { useOnboardingStore } from '../../stores/onboarding-store.js';

/** How long the "press Escape again" confirmation stays up before resetting. */
const CONFIRM_SKIP_TIMEOUT_MS = 3000;

type Step = {
  emoji: string;
  title: string;
  body: string;
  visual: React.JSX.Element;
};

const STEPS: readonly Step[] = [
  {
    emoji: '👋',
    title: 'Welcome to Fixora',
    body: 'AI-powered code repair for developers.',
    visual: <div className="text-6xl">🛠️</div>,
  },
  {
    emoji: '📁',
    title: 'Open Your Project',
    body: "Click 'Open Folder' to load your codebase.",
    visual: (
      <div className="flex items-center gap-2 text-3xl">
        <span>📂</span>
        <span className="text-accent-text">←</span>
        <span className="text-sm text-fg-muted">Files sidebar</span>
      </div>
    ),
  },
  {
    emoji: '🔍',
    title: 'Analyze Your Code',
    body: "Click 'Fix & Analyze' to find issues.",
    visual: <div className="animate-pulse text-6xl">🔍</div>,
  },
  {
    emoji: '⚡',
    title: 'Fix with AI',
    body: 'Click Repair on any issue — AI fixes it instantly.',
    visual: (
      <div className="rounded-lg border border-border-strong bg-inset px-4 py-3 text-left text-xs text-fg-muted">
        <p className="font-medium text-fg">Unused variable</p>
        <p className="mt-1">line 42 · repair.ts</p>
      </div>
    ),
  },
  {
    emoji: '🚀',
    title: "You're Ready!",
    body: 'Start with Explain (free) to understand issues.',
    visual: <div className="text-6xl">🚀</div>,
  },
];

const LAST_STEP = STEPS.length - 1;

/** The first-launch walkthrough. Shown once (`onboarding-store.ts` persists the flag), full
 * screen, skippable at every step. */
export function OnboardingModal(): React.JSX.Element | null {
  const hasSeenOnboarding = useOnboardingStore((s) => s.hasSeenOnboarding);
  const currentStep = useOnboardingStore((s) => s.currentStep);
  const nextStep = useOnboardingStore((s) => s.nextStep);
  const skipOnboarding = useOnboardingStore((s) => s.skipOnboarding);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);

  // Escape is a real "close" gesture elsewhere in the app, so a single accidental press must not
  // silently skip a tour the user meant to keep — the first press only arms a confirmation, which
  // clears itself (on a timeout, or on any other key) rather than staying armed indefinitely.
  const [confirmSkip, setConfirmSkip] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const clearConfirm = (): void => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setConfirmSkip(false);
  };

  const handleEscape = (): void => {
    if (confirmSkip) {
      clearConfirm();
      skipOnboarding();
      return;
    }
    setConfirmSkip(true);
    confirmTimerRef.current = setTimeout(clearConfirm, CONFIRM_SKIP_TIMEOUT_MS);
  };

  if (hasSeenOnboarding) return null;

  const step = STEPS[currentStep] ?? STEPS[0];
  if (!step) return null;
  const isLast = currentStep >= LAST_STEP;

  return (
    <Dialog open>
      <DialogContent
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col items-center justify-center gap-6 rounded-3xl bg-[#0a0a0a] text-center"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleEscape();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' && confirmSkip) clearConfirm();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
      >
        <div className="flex flex-col items-center gap-6" key={currentStep}>
          <div className="animate-ios-enter">{step.visual}</div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-2xl font-semibold text-fg">
              {step.title} {step.emoji}
            </DialogTitle>
            <DialogDescription className="max-w-sm text-sm text-fg-muted">
              {step.body}
            </DialogDescription>
          </div>
        </div>

        {confirmSkip && (
          <p role="status" className="text-xs text-fg-muted">
            Press Escape again to skip the tour
          </p>
        )}

        <div className="flex items-center gap-2" role="tablist" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              role="tab"
              aria-selected={i === currentStep}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === currentStep ? 'bg-accent-text' : 'bg-border-strong',
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          {!isLast && (
            <Button variant="ghost" size="sm" onClick={skipOnboarding}>
              Skip
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={isLast ? completeOnboarding : nextStep}>
            {isLast ? 'Start Using Fixora' : currentStep === 0 ? 'Get Started' : 'Next'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
