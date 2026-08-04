/**
 * Build-time constants injected by electron-vite's `define`. Declared here so main can read them
 * without a cast, and so a missing define is a type error rather than a runtime `undefined`.
 */
declare const __FIXORA_COMMIT__: string;

/** ISO timestamp of when this bundle was built. */
declare const __FIXORA_BUILT_AT__: string;

/** Whether the working tree was dirty at build time. */
declare const __FIXORA_DIRTY__: boolean;
