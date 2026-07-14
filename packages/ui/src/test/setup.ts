import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom omits a few browser APIs that Radix and cmdk use for layout and pointer handling. These
 * stubs let those components mount in tests; they simulate no real layout (jsdom computes none),
 * which is why item-windowing and cmdk filtering are verified in the real app instead.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const proto = Element.prototype as unknown as Record<string, unknown>;
proto['hasPointerCapture'] ??= (): boolean => false;
proto['setPointerCapture'] ??= (): void => undefined;
proto['releasePointerCapture'] ??= (): void => undefined;
proto['scrollIntoView'] ??= (): void => undefined;

// Unmount React trees between tests so one test's DOM cannot leak into the next — the classic
// source of a test that passes alone and fails in the suite.
afterEach(() => {
  cleanup();
});
