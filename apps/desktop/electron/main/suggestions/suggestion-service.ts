import { UserFacingError, type Suggestion } from '@fixora/shared-types';

import type { SuggestionRepository } from './suggestion-repository.js';
import { buildShareEmail, type ShareEmail } from './suggestion-share-email.js';
import { validateSuggestionInput } from './suggestion-validator.js';

/**
 * The service layer: orchestrates validate → persist, and owns the one export format (JSON) plus
 * the share-email content (Sprint F1.1). It is the only layer the IPC handler talks to — the
 * handler never touches the repository, storage, or validator directly, so the request/response
 * shape at the IPC boundary and the domain shape here can evolve independently.
 */

export type SuggestionServiceDeps = {
  repository: SuggestionRepository;
  /** `app.getVersion()` and `process.platform`, injected rather than read here — keeps the service
   *  free of an Electron import, so it stays constructible (and testable) without one. */
  appVersion: string;
  platform: string;
};

export function createSuggestionService(deps: SuggestionServiceDeps) {
  return {
    /** Validate and persist. Throws a UserFacingError with the exact reason on invalid input. */
    submit(input: { category: string; message: string }): Suggestion {
      const validated = validateSuggestionInput(input);
      if (!validated.ok) {
        throw new UserFacingError(validated.error, {
          code: 'invalid_suggestion',
          action: { type: 'none', label: 'Dismiss' },
          stage: 'suggestions',
        });
      }
      return deps.repository.create(validated.value);
    },

    list(): Suggestion[] {
      return deps.repository.list();
    },

    remove(id: string): void {
      deps.repository.remove(id);
    },

    clear(): void {
      deps.repository.clear();
    },

    /** Every suggestion as a pretty-printed JSON document — the entire content of an export file. */
    exportToJson(): string {
      return JSON.stringify(deps.repository.list(), null, 2);
    },

    /**
     * The subject/body for sharing one suggestion by email, or null if that id no longer exists.
     * `workspaceName` is passed per call (not a construction-time dep like `appVersion`/`platform`)
     * because the open workspace can change between requests within the same process lifetime.
     */
    buildShareEmail(id: string, context: { workspaceName: string | null }): ShareEmail | null {
      const suggestion = deps.repository.findById(id);
      if (suggestion === undefined) return null;
      return buildShareEmail({
        category: suggestion.category,
        message: suggestion.message,
        appVersion: deps.appVersion,
        platform: deps.platform,
        workspaceName: context.workspaceName,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

export type SuggestionService = ReturnType<typeof createSuggestionService>;
