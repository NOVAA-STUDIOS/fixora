/// <reference types="vite/client" />

// Brings the jest-dom matcher augmentation (toBeInTheDocument, toHaveAccessibleName, …) into the
// type scope of the renderer tests, which compile under tsconfig.web.json. Without this the
// matchers resolve to `any` and the strict lint flags them as unsafe calls.
import '@testing-library/jest-dom/vitest';

// Vite's `?worker` imports export a Worker constructor as default. The type resolver behind the
// import-x/default lint rule does not follow the `vite/client` ambient module, so we declare it
// once here so the Monaco worker imports are recognised as having a default export.
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
