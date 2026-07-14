import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom for the whole package: the renderer tests need a DOM, and the main-process tests
    // (which mock `electron` and use node:fs/child_process) run fine under jsdom too — jsdom
    // adds DOM globals on top of Node, it does not remove Node.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
