import { randomUUID } from 'node:crypto';

import type { Suggestion, SuggestionCategory } from '@fixora/shared-types';

import type { Row } from '../db/driver.js';

import type { SuggestionStorage } from './suggestion-storage.js';

/**
 * The repository layer: the domain-shaped view of suggestions. It depends on storage, never on the
 * driver directly — a repository call always returns a `Suggestion`, never a raw `Row`. This is the
 * boundary the service talks to; storage and its column names are invisible above this line.
 */

function toSuggestion(row: Row): Suggestion {
  return {
    id: row['id'] as string,
    category: row['category'] as SuggestionCategory,
    message: row['message'] as string,
    createdAt: row['created_at'] as number,
  };
}

export function createSuggestionRepository(storage: SuggestionStorage, now: () => number = Date.now) {
  return {
    /** Persist a new, already-validated suggestion and return the record as stored. */
    create(input: { category: SuggestionCategory; message: string }): Suggestion {
      const suggestion: Suggestion = {
        id: randomUUID(),
        category: input.category,
        message: input.message,
        createdAt: now(),
      };
      storage.insert({
        id: suggestion.id,
        category: suggestion.category,
        message: suggestion.message,
        createdAt: suggestion.createdAt,
      });
      return suggestion;
    },

    /** Every suggestion, newest first — the local history the user can review or export. */
    list(limit = 500): Suggestion[] {
      return storage.selectAll(limit).map(toSuggestion);
    },

    /** One suggestion by id, or undefined — what sharing looks up before composing an email. */
    findById(id: string): Suggestion | undefined {
      const row = storage.selectById(id);
      return row === undefined ? undefined : toSuggestion(row);
    },

    remove(id: string): void {
      storage.deleteById(id);
    },

    clear(): void {
      storage.deleteAll();
    },
  };
}

export type SuggestionRepository = ReturnType<typeof createSuggestionRepository>;
