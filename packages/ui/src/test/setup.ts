import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount React trees between tests so one test's DOM cannot leak into the next — the classic
// source of a test that passes alone and fails in the suite.
afterEach(() => {
  cleanup();
});
