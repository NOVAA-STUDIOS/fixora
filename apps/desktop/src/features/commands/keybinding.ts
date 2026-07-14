/**
 * Keybinding parsing and matching. A binding is a lowercase, `+`-joined string like `mod+k`,
 * `mod+shift+p`, or `escape`. `mod` resolves to ⌘ on macOS and Ctrl elsewhere, so one binding
 * string is correct on every platform — the alternative (per-OS binding tables) is where
 * shortcut drift breeds.
 */

export type ParsedBinding = {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
};

const isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.toLowerCase().split('+');
  const result: ParsedBinding = { key: '', mod: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === 'mod') result.mod = true;
    else if (part === 'shift') result.shift = true;
    else if (part === 'alt') result.alt = true;
    else result.key = part;
  }
  return result;
}

/** Does a keyboard event match this binding? Exact modifier match — no accidental supersets. */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const b = parseBinding(binding);
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  // On the platform where `mod` is NOT the key, that key must be absent — `mod+k` must not fire
  // on ⌘K on Windows (where ⌘ is the Windows key) or Ctrl+K on macOS.
  const otherMod = isMac ? event.ctrlKey : event.metaKey;

  return (
    event.key.toLowerCase() === b.key &&
    modPressed === b.mod &&
    (b.mod ? true : !otherMod) &&
    event.shiftKey === b.shift &&
    event.altKey === b.alt &&
    !otherMod
  );
}

/** Human-readable rendering for the palette/menu: `⌘K`, `Ctrl+Shift+P`. */
export function formatBinding(binding: string): string {
  const b = parseBinding(binding);
  const mod = isMac ? '⌘' : 'Ctrl';
  const parts: string[] = [];
  if (b.mod) parts.push(mod);
  if (b.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (b.alt) parts.push(isMac ? '⌥' : 'Alt');
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : titleCase(b.key));
  return isMac ? parts.join('') : parts.join('+');
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
