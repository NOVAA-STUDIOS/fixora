import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Ladle needs Tailwind v4 to process the primitives' utility classes and the token CSS, exactly
 * as the app does. Without it the stories render unstyled and the whole point of a component
 * workbench is lost.
 */
export default defineConfig({
  plugins: [tailwindcss()],
});
