import { AiFailureSchema } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { FAILURE_STATUS_LABEL, RECOVERY_ACTION_LABEL } from './failure-model.js';

/**
 * The failure vocabulary is declared twice on purpose: once in core-ai (where it is produced) and once
 * in shared-types (where it is validated at the IPC boundary), because shared-types must not depend on
 * the AI package. Duplication that nobody checks is duplication that drifts — and the drift is silent
 * and total: zod rejects the unknown category, the router redacts the validation error, and the panel
 * shows "Something went wrong" for a failure we classified perfectly.
 *
 * These walk both sets in both directions, so adding a category on either side fails here rather than
 * in a user's session.
 */
describe('failure vocabulary is identical on both sides of the IPC boundary', () => {
  const shape = AiFailureSchema.shape;
  const wireCategories = shape.category.options;
  const wireActions = shape.actions.element.options;

  it('every category core-ai can produce is accepted on the wire', () => {
    expect([...wireCategories].sort()).toEqual(Object.keys(FAILURE_STATUS_LABEL).sort());
  });

  it('every recovery action core-ai can offer is accepted on the wire', () => {
    expect([...wireActions].sort()).toEqual(Object.keys(RECOVERY_ACTION_LABEL).sort());
  });

  it('every category has a human status label — the card has a Status row to fill', () => {
    for (const category of wireCategories) {
      expect(FAILURE_STATUS_LABEL[category], category).toBeTruthy();
    }
  });

  it('the wire refuses a failure with no recovery actions', () => {
    const base = { category: 'timeout', layer: 'provider', provider: 'OpenRouter', model: 'm' };
    expect(AiFailureSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
    expect(AiFailureSchema.safeParse({ ...base, actions: ['retry'] }).success).toBe(true);
  });
});
