import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names, with later Tailwind utilities winning conflicts.
 *
 * `clsx` handles conditional/array class lists; `twMerge` resolves the case where a variant and
 * a caller both set, say, `px-*` — the caller's wins, instead of both landing in the class list
 * and the cascade deciding by source order (which is unstable across builds). Every primitive
 * takes a `className` prop and merges it through here, so a consumer can always override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
