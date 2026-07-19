import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Raised from vitest's 5000ms default because of an intermittent failure that was not a bug in
     * the code under test.
     *
     * Almost every analyzer test grounds its findings through `symbolsFor`, which is a tree-sitter
     * parse — and the first parse for a language pays a one-off cost to initialise the WASM runtime
     * and load that grammar. The observed failure was the go-vet adapter test at **5173ms**: a few
     * hundred milliseconds past the default, on a run where several workers were competing for CPU.
     * It passed in isolation and on a clean re-run, which is the signature of contention rather than
     * a race.
     *
     * It is specifically *not* a race: `initPromise` and the grammar cache in parser/tree-sitter.ts
     * are module-level and promise-cached, so a worker initialises each grammar exactly once, and
     * vitest workers have separate module registries so they cannot interfere with each other.
     *
     * So the timeout was measuring machine load rather than correctness. A suite that goes red on a
     * busy CI box teaches people to re-run failing builds without reading them, which costs far more
     * than the seconds this gives back. 20s is still low enough that a genuinely hung test fails the
     * run instead of stalling it.
     */
    testTimeout: 20_000,
  },
});
