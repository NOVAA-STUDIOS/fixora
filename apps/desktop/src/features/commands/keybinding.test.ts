import { describe, expect, it } from 'vitest';

import { formatBinding, matchesBinding, parseBinding } from './keybinding.js';

// jsdom reports a non-Mac platform, so `mod` resolves to Ctrl here — which is what CI runs.

describe('parseBinding', () => {
  it('splits modifiers from the key', () => {
    expect(parseBinding('mod+shift+p')).toEqual({ key: 'p', mod: true, shift: true, alt: false });
    expect(parseBinding('escape')).toEqual({ key: 'escape', mod: false, shift: false, alt: false });
  });
});

describe('matchesBinding (non-Mac: mod = Ctrl)', () => {
  const ev = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

  it('matches Ctrl+K for mod+k', () => {
    expect(matchesBinding(ev({ key: 'k', ctrlKey: true }), 'mod+k')).toBe(true);
  });

  it('does not match a bare k for mod+k', () => {
    expect(matchesBinding(ev({ key: 'k' }), 'mod+k')).toBe(false);
  });

  it('does not fire mod+k on the Meta (Windows) key', () => {
    // On Windows, ⌘/Meta is the Windows key — a mod+k binding must not trigger on it.
    expect(matchesBinding(ev({ key: 'k', metaKey: true }), 'mod+k')).toBe(false);
  });

  it('requires the exact modifier set (no accidental supersets)', () => {
    expect(matchesBinding(ev({ key: 'k', ctrlKey: true, shiftKey: true }), 'mod+k')).toBe(false);
    expect(matchesBinding(ev({ key: 'p', ctrlKey: true, shiftKey: true }), 'mod+shift+p')).toBe(
      true,
    );
  });
});

describe('formatBinding (non-Mac)', () => {
  it('renders a readable chord', () => {
    expect(formatBinding('mod+k')).toBe('Ctrl+K');
    expect(formatBinding('mod+shift+p')).toBe('Ctrl+Shift+P');
  });
});
