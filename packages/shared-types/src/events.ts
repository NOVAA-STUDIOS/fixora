import { z } from 'zod';

import type { EventChannel } from './channels.js';
import { FilesChangedSchema } from './workspace.js';

/**
 * The main → renderer event contracts (push). The counterpart to `contracts` in ipc.ts, for the
 * one direction that is unsolicited: main tells the renderer something changed.
 *
 * Same drift-proofing as the request registry — `satisfies Record<EventChannel, …>` makes a
 * declared event without a schema, or a schema without a declared channel, a compile error. The
 * emitter in main validates the payload against this schema before sending, so the renderer's
 * subscription always receives a known shape; the preload stays zod-free and just forwards.
 */

export const WindowMaximizedChangedSchema = z.object({
  isMaximized: z.boolean(),
});
export type WindowMaximizedChanged = z.infer<typeof WindowMaximizedChangedSchema>;

export const eventContracts = {
  'window:maximizedChanged': WindowMaximizedChangedSchema,
  'workspace:filesChanged': FilesChangedSchema,
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventContracts = typeof eventContracts;
export type EventPayloadOf<E extends EventChannel> = z.infer<EventContracts[E]>;
