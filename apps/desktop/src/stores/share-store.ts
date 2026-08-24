import { create } from 'zustand';

/**
 * When to offer the share dialog. Same discipline as `feedback-store.ts`: a prompt that keeps
 * reappearing after being declined is the fastest way to sour someone on an otherwise-good tool,
 * so "Maybe Later" is taken literally, and after three declines it never asks again.
 */
const STORAGE_KEY = 'fixora.share.v1';

/** Offer the dialog after every 5th successful repair. */
const PROMPT_EVERY = 5;
/** After this many "Maybe Later"s, stop asking permanently. */
const MAX_DISMISSALS = 3;

type Stored = {
  repairCount: number;
  dismissCount: number;
  hasSharedBefore: boolean;
};

function loadStored(): Stored {
  const fresh: Stored = { repairCount: 0, dismissCount: 0, hasSharedBefore: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fresh;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      repairCount: typeof parsed.repairCount === 'number' ? parsed.repairCount : 0,
      dismissCount: typeof parsed.dismissCount === 'number' ? parsed.dismissCount : 0,
      hasSharedBefore: parsed.hasSharedBefore === true,
    };
  } catch {
    return fresh;
  }
}

function persist(state: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable — the prompt then behaves as if this were a first run, which is a
    // cosmetic annoyance rather than something worth failing over.
  }
}

type ShareState = {
  repairCount: number;
  dismissCount: number;
  hasSharedBefore: boolean;
  open: boolean;
  /** Called after every successful repair. Opens the dialog every 5th time, unless dismissed out. */
  recordRepair: () => void;
  /** "Maybe Later" — stops asking permanently after the 3rd time. */
  dismiss: () => void;
  /** The user actually shared. Recorded, dialog closes. */
  markShared: () => void;
};

const initial = loadStored();

export const useShareStore = create<ShareState>((set, get) => ({
  repairCount: initial.repairCount,
  dismissCount: initial.dismissCount,
  hasSharedBefore: initial.hasSharedBefore,
  open: false,

  recordRepair: () => {
    const { dismissCount } = get();
    const repairCount = get().repairCount + 1;
    set({ repairCount });
    persist({ repairCount, dismissCount, hasSharedBefore: get().hasSharedBefore });
    if (dismissCount < MAX_DISMISSALS && repairCount % PROMPT_EVERY === 0) {
      set({ open: true });
    }
  },

  dismiss: () => {
    const dismissCount = get().dismissCount + 1;
    set({ dismissCount, open: false });
    persist({
      repairCount: get().repairCount,
      dismissCount,
      hasSharedBefore: get().hasSharedBefore,
    });
  },

  markShared: () => {
    set({ hasSharedBefore: true, open: false });
    persist({
      repairCount: get().repairCount,
      dismissCount: get().dismissCount,
      hasSharedBefore: true,
    });
  },
}));
