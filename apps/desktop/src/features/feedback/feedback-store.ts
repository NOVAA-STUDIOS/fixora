import { create } from 'zustand';

/**
 * When to ask for feedback.
 *
 * The rule that matters is the one about NOT asking: a prompt that reappears is the fastest way to
 * make someone dislike a tool they were otherwise enjoying. So it is asked after the product has
 * actually done something useful (three successful repairs — not three launches), and it stops
 * permanently after a submission or a second decline. "Maybe later" is taken literally, once.
 */
const STORAGE_KEY = 'fixora.feedback.v1';

/** Repairs before the first ask. Three is enough to have an opinion and few enough to still be
 *  within the session where the product proved itself. */
const FIRST_PROMPT_AT = 3;
/** How many further repairs a "Maybe later" buys. */
const SNOOZE_REPAIRS = 5;
/** After this many declines the question is never asked again. */
const MAX_DISMISSALS = 2;

type Stored = {
  repairCount: number;
  dismissals: number;
  /** True once submitted, or once dismissed `MAX_DISMISSALS` times. Terminal either way. */
  done: boolean;
  /** The repair count at which the next prompt becomes due. */
  nextPromptAt: number;
};

function loadStored(): Stored {
  const fresh: Stored = { repairCount: 0, dismissals: 0, done: false, nextPromptAt: FIRST_PROMPT_AT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fresh;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      repairCount: typeof parsed.repairCount === 'number' ? parsed.repairCount : 0,
      dismissals: typeof parsed.dismissals === 'number' ? parsed.dismissals : 0,
      done: parsed.done === true,
      nextPromptAt: typeof parsed.nextPromptAt === 'number' ? parsed.nextPromptAt : FIRST_PROMPT_AT,
    };
  } catch {
    return fresh;
  }
}

function persist(state: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable. The prompt then behaves as if this were a first run, which is a
    // cosmetic annoyance rather than something worth failing over.
  }
}

type FeedbackState = {
  repairCount: number;
  dismissals: number;
  done: boolean;
  nextPromptAt: number;
  open: boolean;
  /** Called after every successful repair. Opens the dialog when the count reaches the threshold. */
  recordRepair: () => void;
  /** "Maybe later" — snooze, or stop asking entirely on the second decline. */
  dismiss: () => void;
  /** Feedback was sent. Never ask again. */
  markSubmitted: () => void;
};

const initial = loadStored();

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  repairCount: initial.repairCount,
  dismissals: initial.dismissals,
  done: initial.done,
  nextPromptAt: initial.nextPromptAt,
  open: false,

  recordRepair: () => {
    const { done } = get();
    const repairCount = get().repairCount + 1;
    const { dismissals, nextPromptAt } = get();
    set({ repairCount });
    persist({ repairCount, dismissals, done, nextPromptAt });
    // Never re-opens once finished, and never interrupts a repair that is still in flight — this
    // is called after the write has already succeeded.
    if (!done && repairCount >= nextPromptAt) set({ open: true });
  },

  dismiss: () => {
    const dismissals = get().dismissals + 1;
    const done = dismissals >= MAX_DISMISSALS;
    const nextPromptAt = get().repairCount + SNOOZE_REPAIRS;
    set({ dismissals, done, nextPromptAt, open: false });
    persist({ repairCount: get().repairCount, dismissals, done, nextPromptAt });
  },

  markSubmitted: () => {
    set({ done: true, open: false });
    persist({
      repairCount: get().repairCount,
      dismissals: get().dismissals,
      done: true,
      nextPromptAt: Number.MAX_SAFE_INTEGER,
    });
  },
}));
