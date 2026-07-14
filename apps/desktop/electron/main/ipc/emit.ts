import { eventContracts, type EventChannel, type EventPayloadOf } from '@fixora/shared-types';
import { type BrowserWindow } from 'electron';

/**
 * The one way main sends a push event to a renderer. It validates the payload against the event
 * contract *before* it leaves the privileged process — the mirror of the router validating
 * inbound requests. So the renderer's subscription is guaranteed a known shape, and a bug where
 * main sends the wrong thing is caught here (with a log) rather than becoming an undefined-read
 * three components deep in the renderer.
 */
export function emitToWindow<E extends EventChannel>(
  window: BrowserWindow,
  channel: E,
  payload: EventPayloadOf<E>,
): void {
  const parsed = eventContracts[channel].safeParse(payload);
  if (!parsed.success) {
    console.error('[ipc] refused to emit a malformed event', { channel });
    return;
  }
  if (window.isDestroyed()) return;
  window.webContents.send(channel, parsed.data);
}
