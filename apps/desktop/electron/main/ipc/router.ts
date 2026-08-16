import {
  channels,
  contracts,
  err,
  ok,
  type Channel,
  type ErrorAction,
  type FixoraError,
  type FixoraErrorCode,
  type RequestOf,
  type ResponseOf,
  type Result,
  isUserFacingError,
} from '@fixora/shared-types';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

/**
 * The typed IPC router (ADR-018).
 *
 * It validates **both directions**. Validating renderer → main is the obvious half: the
 * renderer is hostile and its payloads are attacker-controlled. Validating main → renderer is
 * the half people skip, and it is the half that catches *our* bugs — a handler that quietly
 * returns `undefined` on an edge case would otherwise reach the UI as a runtime crash in a
 * component, three layers from the cause.
 *
 * ~130 lines, no tRPC. The dependency would buy us type safety we already have from zod plus
 * a layer between the renderer and the privileged process, which is the last place we want a
 * layer we didn't write.
 */

export type Handler<C extends Channel> = (
  request: RequestOf<C>,
  context: HandlerContext,
) => Promise<ResponseOf<C>> | ResponseOf<C>;

export type HandlerContext = {
  /** Propagated renderer → main → API → provider, so "it broke" becomes one traceable string. */
  requestId: string;
  /** The window the call came from — window controls act on the caller, not a global. */
  window: BrowserWindow | null;
};

type Registry = { [C in Channel]?: Handler<C> };

const registry: Registry = {};

export function registerHandler<C extends Channel>(channel: C, handler: Handler<C>): void {
  if (registry[channel] !== undefined) {
    throw new Error(`IPC channel registered twice: ${channel}`);
  }
  // The registry is heterogeneous: each channel's handler has its own request/response types,
  // which TypeScript cannot represent in one object without existential generics. The cast is
  // sound — `channel` and `handler` carry the same `C` at every call site — and the value is
  // re-narrowed against `contracts[channel]` on read in mountRouter, which is where safety
  // actually matters (the payload is validated there before the handler ever sees it).
  (registry as Record<Channel, Handler<C>>)[channel] = handler;
}

/** The registered handler for a channel, or undefined. Used by mountRouter and by tests. */
export function getHandler<C extends Channel>(channel: C): Handler<C> | undefined {
  return registry[channel];
}

/**
 * A declared channel with no handler is a **placeholder**, and Standards §2 is explicit that
 * placeholders do not ship: "if it isn't implemented, it throws, and the milestone isn't done."
 *
 * So we refuse to start. The alternative — returning a polite runtime error to the renderer —
 * means a half-built channel can reach a user's machine and merely *look* like a transient
 * failure, which is the worst of both worlds: it ships, and it lies about why it failed.
 */
export function assertEveryChannelIsHandled(): void {
  const orphans = channels.filter((channel) => registry[channel] === undefined);
  if (orphans.length > 0) {
    throw new Error(
      `IPC channels declared with no handler: ${orphans.join(', ')}. ` +
        'Either implement the handler or remove the channel from the contract registry. ' +
        'A declared channel with no implementation is a placeholder (Standards §2).',
    );
  }
}

/**
 * The envelope every invocation arrives in. It is validated before the channel name is even
 * trusted, because a channel name is itself attacker-controlled input.
 */
type Envelope = { requestId: unknown; payload: unknown };

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'requestId' in value && 'payload' in value;
}

export function mountRouter(): void {
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<unknown>> => {
      const requestId =
        isEnvelope(raw) && typeof raw.requestId === 'string' ? raw.requestId : 'unknown';

      // Only the top frame of our own window may call IPC. Today the CSP forbids frames and
      // webviews outright, so a subframe cannot exist — this is defense-in-depth against a
      // future CSP regression, and it costs one comparison. A legitimate call always comes
      // from the top frame (senderFrame.parent === null); anything else is rejected as a
      // contract violation rather than reaching a handler.
      if (event.senderFrame !== null && event.senderFrame.parent !== null) {
        console.error('[ipc] rejected call from a non-top frame', { channel, requestId });
        return err(contractViolation(requestId));
      }

      if (!isEnvelope(raw)) {
        return err(contractViolation(requestId));
      }

      // TEMP-DIAGNOSTIC BUG-002 pre-zod (Q3 file-corruption incident — remove after root cause).
      // The one point in the whole app where `raw.payload` is truly as it arrived off the IPC
      // wire — every handler-side marker (fs-service.ts, ai.handlers.ts, proceed-service.ts) only
      // ever sees it AFTER `safeParse` below, so none of them could tell a transport-level
      // corruption apart from one already present in the renderer's own string. Gated the same way
      // as every other Q3 marker: only for the disposable repro filename, probed defensively since
      // `raw.payload` is `unknown` here — the shape it should have is exactly what's in question.
      if (
        (channel === 'ai:applyRepair' || channel === 'proceed:run') &&
        typeof raw.payload === 'object' &&
        raw.payload !== null &&
        'file' in raw.payload &&
        typeof (raw.payload as { file: unknown }).file === 'string' &&
        (raw.payload as { file: string }).file.includes('proceed-diag')
      ) {
        const rawJson = JSON.stringify(raw.payload);
        const nulCount = rawJson.split(String.fromCharCode(0)).length - 1;
        console.error('[Q3-DIAG] router: raw payload before safeParse', {
          channel,
          byteLength: Buffer.byteLength(rawJson, 'utf8'),
          nulCount,
          preview: rawJson.slice(0, 100),
        });
      }

      const contract = contracts[channel];
      const parsedRequest = contract.request.safeParse(raw.payload);
      if (!parsedRequest.success) {
        // Do not echo the payload back, and do not log it: it may contain source code.
        console.error('[ipc] request failed validation', { channel, requestId });
        return err(contractViolation(requestId));
      }

      // Guaranteed present by assertEveryChannelIsHandled() at startup.
      const handler = registry[channel] as Handler<typeof channel>;

      const window = BrowserWindow.fromWebContents(event.sender);

      // Every handler runs on main's single event loop thread — one that blocks it (a synchronous
      // fs call, a heavy computation) stalls every other pending IPC call and window message at
      // once, which is what "Fixora (Not Responding)" actually is. Logged past 100ms so a slow
      // handler shows up by name instead of as an unexplained stall the user has to reproduce.
      const startedAt = performance.now();
      let response: unknown;
      try {
        response = await handler(parsedRequest.data, { requestId, window });
        const elapsedMs = performance.now() - startedAt;
        if (elapsedMs > 100) {
          log.warn('[ipc] slow handler', { channel, requestId, elapsedMs: Math.round(elapsedMs) });
        }
      } catch (error) {
        // MAIN gets everything. The log is on the user's own machine and is the only record of what
        // actually happened; logging just `error.name` made "Something went wrong" unfalsifiable
        // from both sides at once — the user could not see the cause and neither could the log.
        console.error('[ipc] handler threw', {
          channel,
          requestId,
          elapsedMs: Math.round(performance.now() - startedAt),
          name: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        // A handler that anticipated this condition wrote a sentence for it. Passing that through
        // is not a weakening of the redaction: UserFacingError is an assertion by its thrower that
        // the message is human-facing and path-free. Everything else is still fully redacted below.
        if (isUserFacingError(error)) {
          return err(
            fail(
              'IPC_HANDLER_FAILED',
              requestId,
              error.message,
              error.options.action ?? { type: 'none', label: 'Dismiss' },
            ),
          );
        }

        // The renderer gets a code and a next step. It does not get our stack trace: a stack
        // carries absolute paths, and absolute paths are user data (Security §9).
        return err(
          fail(
            'IPC_HANDLER_FAILED',
            requestId,
            'Something went wrong handling that action.',
            // A handler that threw may well succeed on a retry — a transient FS or network
            // condition is the common case. This is the one place "try again" is honest.
            { type: 'retry', label: 'Try again' },
          ),
        );
      }

      const parsedResponse = contract.response.safeParse(response);
      if (!parsedResponse.success) {
        console.error('[ipc] response failed validation', { channel, requestId });
        return err(contractViolation(requestId));
      }

      return ok(parsedResponse.data);
    });
  }
}

/**
 * A contract violation is **deterministic**: the same message will fail the same way forever.
 * Telling the user to "try again" would be a lie, and Standards §5 asks every error to name the
 * *next step* — a wrong next step is worse than none, because the user spends their patience on
 * it before giving up. The honest next step is to report it, so we say so.
 */
function contractViolation(requestId: string): FixoraError {
  return fail(
    'IPC_CONTRACT_VIOLATION',
    requestId,
    'Fixora rejected an internal message that did not match its contract. This is a bug in ' +
      'Fixora, not something you did. Retrying will not help.',
    {
      type: 'open_url',
      label: 'Report this bug',
      url: 'https://github.com/fixora/fixora-desktop/issues/new',
    },
  );
}

function fail(
  code: FixoraErrorCode,
  requestId: string,
  message: string,
  action: ErrorAction,
): FixoraError {
  return { code, message, action, requestId };
}
