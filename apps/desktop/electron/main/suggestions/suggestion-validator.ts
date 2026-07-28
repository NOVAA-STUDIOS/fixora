import {
  SUGGESTION_MESSAGE_MAX_LENGTH,
  SUGGESTION_MESSAGE_MIN_LENGTH,
  SuggestionCategorySchema,
  type SuggestionCategory,
} from '@fixora/shared-types';

/**
 * The validator layer: pure, synchronous, no I/O. It knows the rules a suggestion must satisfy and
 * nothing about how one is stored or transported — a category the renderer sends is validated here
 * before it ever reaches the repository, so an invalid category or a stray empty message can never
 * become a row.
 */

export type SuggestionValidationResult =
  | { ok: true; value: { category: SuggestionCategory; message: string } }
  | { ok: false; error: string };

export function validateSuggestionInput(input: {
  category: string;
  message: string;
}): SuggestionValidationResult {
  const category = SuggestionCategorySchema.safeParse(input.category);
  if (!category.success) {
    return { ok: false, error: 'Choose a category for your suggestion.' };
  }

  const message = input.message.trim();
  if (message.length === 0) {
    return { ok: false, error: 'Write your suggestion before submitting.' };
  }
  if (message.length < SUGGESTION_MESSAGE_MIN_LENGTH) {
    return {
      ok: false,
      error: `Your suggestion is too short — add a bit more detail (at least ${String(SUGGESTION_MESSAGE_MIN_LENGTH)} characters).`,
    };
  }
  if (message.length > SUGGESTION_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Your suggestion is too long — keep it under ${String(SUGGESTION_MESSAGE_MAX_LENGTH)} characters.`,
    };
  }

  return { ok: true, value: { category: category.data, message } };
}
