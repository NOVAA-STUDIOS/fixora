import { useLayoutEffect, useRef } from 'react';

/**
 * Grows a textarea to fit its content, up to `maxPx`, instead of scrolling internally. Resetting
 * height to 'auto' before reading `scrollHeight` is deliberate: without it the element's own current
 * height caps what `scrollHeight` reports, so the box would never shrink back down after a paste
 * followed by a delete.
 */
export function useAutoResizeTextarea(
  value: string,
  { minPx = 96, maxPx = 320 }: { minPx?: number; maxPx?: number } = {},
): React.RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minPx), maxPx);
    el.style.height = `${String(next)}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [value, minPx, maxPx]);

  return ref;
}
