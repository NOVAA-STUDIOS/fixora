import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { useLicenseStore } from '../stores/license-store.js';

/**
 * jsdom omits a handful of browser APIs that Radix and cmdk use for layout and pointer handling.
 * These are the standard stubs that let those components mount in tests; they do not simulate real
 * layout (jsdom computes none), which is why item-level palette behaviour is verified in the real
 * app instead — here we test behaviour and accessibility, not pixels.
 */
class ResizeObserverStub {
  observe(): void {
    /* no layout in jsdom */
  }
  unobserve(): void {
    /* no layout in jsdom */
  }
  disconnect(): void {
    /* no layout in jsdom */
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

// Radix Select/Dialog probe pointer capture and scrolling, which jsdom does not implement.
const proto = Element.prototype as unknown as Record<string, unknown>;
proto['hasPointerCapture'] ??= (): boolean => false;
proto['setPointerCapture'] ??= (): void => undefined;
proto['releasePointerCapture'] ??= (): void => undefined;
proto['scrollIntoView'] ??= (): void => undefined;

afterEach(() => {
  cleanup();
  // The UI store persists to localStorage; clear it so one test's state does not leak into the
  // next (a stored activeView would silently change what the next test renders).
  localStorage.clear();
  // The license store's `repairsToday` counter lives in the Zustand module singleton, not just
  // localStorage — clearing storage alone leaves it non-zero, so a later test's `run('repair', …)`
  // would silently no-op once enough earlier tests in the same file had already "used up" the
  // free-tier daily limit.
  useLicenseStore.setState({ plan: 'free', licenseKey: null, repairsToday: 0, showUpgradeDialog: false });
});
