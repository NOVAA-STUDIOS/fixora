import { create } from 'zustand';

import { useEditorStore } from '../features/editor/editor-store.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { invoke } from '../lib/bridge.js';

import { toast } from './toast-store.js';

/** "Generate Tests" (feature #7): the one in-flight flag, so the toolbar/context-menu entry point
 * and the palette command share the same progress indicator rather than each tracking their own. */
type TestGenerationState = {
  generatingFor: string | null;
  generate: (relPath: string) => Promise<void>;
};

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
};

function languageFor(relPath: string): string | null {
  const ext = relPath.slice(relPath.lastIndexOf('.') + 1);
  return EXT_LANGUAGE[ext] ?? null;
}

export const useTestGenerationStore = create<TestGenerationState>((set) => ({
  generatingFor: null,

  generate: async (relPath) => {
    set({ generatingFor: relPath });
    const result = await invoke('ai:generateTests', { file: relPath });
    set({ generatingFor: null });
    if (!result.ok) {
      toast.error('Could not generate tests', result.error.message);
      return;
    }
    // The file is already written to disk by the handler — refresh the containing directory so it
    // shows up in the tree, then open it as a new tab the same way clicking a file there does.
    const testRelPath = result.value.relPath;
    const dir = testRelPath.includes('/') ? testRelPath.slice(0, testRelPath.lastIndexOf('/')) : '';
    await useWorkspaceStore.getState().refreshDir(dir);
    useEditorStore.getState().openFile(testRelPath, languageFor(testRelPath));
    toast.success(`Generated ${testRelPath}`, result.value.rationale);
  },
}));
