import { useEffect } from 'react';

import { useEditorStore } from '../editor/editor-store.js';

import { useShieldSettingsStore, useShieldStore } from './shield-store.js';

/** How long after a save to re-check. Long enough that a burst of Ctrl+S costs one run. */
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Auto-triggers Code Shield: once when a file becomes active, and again a beat after it is saved.
 *
 * Save is detected from `saving` falling back to null — the editor store sets it for the duration
 * of the write, so that edge is the moment the file on disk actually changed. Analyzing on every
 * keystroke would be re-running real linters against a file the user is mid-thought in.
 */
export function useShieldWatch(): void {
  const activeTab = useEditorStore((s) => s.activeTab);
  const enabled = useShieldSettingsStore((s) => s.enabled);
  // Gates both effects below: the store defaults `enabled` to `true` before the real setting has
  // been read from disk, so without this a Shield the user turned OFF still fires once on the very
  // first file open of the session, before `load()` resolves.
  const loaded = useShieldSettingsStore((s) => s.loaded);
  const loadSettings = useShieldSettingsStore((s) => s.load);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // File opened / switched.
  useEffect(() => {
    if (!loaded || !enabled) return;
    if (activeTab === null) {
      useShieldStore.getState().clear();
      return;
    }
    void useShieldStore.getState().analyze(activeTab);
  }, [activeTab, enabled, loaded]);

  // File saved.
  useEffect(() => {
    if (!loaded || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wasSaving: string | null = useEditorStore.getState().saving;

    const unsubscribe = useEditorStore.subscribe((state) => {
      const saving = state.saving;
      // Falling edge: a write just finished. `saveError` is checked on the store at fire time, so a
      // failed write does not trigger a re-analysis of a file that never changed.
      if (wasSaving !== null && saving === null) {
        const target = wasSaving;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          if (useEditorStore.getState().saveError === null) {
            void useShieldStore.getState().analyze(target);
          }
        }, SAVE_DEBOUNCE_MS);
      }
      wasSaving = saving;
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, loaded]);
}
