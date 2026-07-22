import { UserFacingError } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { describeRunFailure } from '../electron/main/ipc/handlers/ai.handlers.js';

/**
 * P0 Priority 1: `ai:run` must never surface "internal error" / "unknown error" and must never be
 * silent. `describeRunFailure` is the catch-all's wording, pinned here so the forbidden phrases can
 * never creep back in and an authored error is always surfaced verbatim.
 */
describe('describeRunFailure', () => {
  it('surfaces an authored UserFacingError verbatim — it is already user-ready', () => {
    const authored = new UserFacingError(
      'This file is open in another program. Close it and retry.',
      {
        code: 'fs_busy',
        action: { type: 'retry', label: 'Try again' },
      },
    );
    expect(describeRunFailure(authored, 'repair')).toBe(authored.message);
  });

  it('turns an unexpected error into an actionable message — never the forbidden phrases', () => {
    const msg = describeRunFailure(new Error('cannot read properties of undefined'), 'repair');
    expect(msg.toLowerCase()).not.toContain('internal error');
    expect(msg.toLowerCase()).not.toContain('unknown error');
    expect(msg).toContain('cannot read properties of undefined'); // the real detail, never hidden
    expect(msg).toContain('repair'); // names the operation
    expect(msg.toLowerCase()).toContain('report'); // recovery guidance
  });

  it('handles a non-Error throw without losing information', () => {
    const msg = describeRunFailure('a bare string', 'explain');
    expect(msg).toContain('a bare string');
    expect(msg.toLowerCase()).not.toContain('internal error');
  });
});
