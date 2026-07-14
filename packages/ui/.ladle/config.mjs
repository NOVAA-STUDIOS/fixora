/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: 'src/**/*.stories.tsx',
  viteConfig: '.ladle/vite.config.ts',
  addons: {
    theme: {
      // The stories drive our own [data-theme] via a decorator, not Ladle's built-in dark mode.
      enabled: false,
    },
  },
};
