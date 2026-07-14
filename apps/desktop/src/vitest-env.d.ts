// Brings the jest-dom matcher augmentation (toBeInTheDocument, toHaveAccessibleName, …) into the
// type scope of the renderer tests, which compile under tsconfig.web.json. Without this the
// matchers resolve to `any` and the strict lint flags them as unsafe calls.
import '@testing-library/jest-dom/vitest';
