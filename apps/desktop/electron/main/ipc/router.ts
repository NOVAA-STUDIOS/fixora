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
} from '@fixora/shared-types';
import { ipcMain } from 'electron';

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
};

type Registry = { [C in Channel]?: Handler<C> };

const registry: Registry = {};

export function registerHandler<C extends Channel>(channel: C, handler: Handler<C>): void {
  if (registry[channel] !== undefined) {
    throw new Error(`IPC channel registered twice: ${channel}`);
  }
  registry[channel] = handler;
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
    ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<unknown>> => {
      const requestId =
        isEnvelope(raw) && typeof raw.requestId === 'string' ? raw.requestId : 'unknown';

      if (!isEnvelope(raw)) {
        return err(contractViolation(requestId));
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

      let response: unknown;
      try {
        response = await handler(parsedRequest.data, { requestId });
      } catch (error) {
        // The renderer gets a code and a next step. It does not get our stack trace: a stack
        // carries absolute paths, and absolute paths are user data (Security §9).
        console.error('[ipc] handler threw', {
          channel,
          requestId,
          error: error instanceof Error ? error.name : 'unknown',
        });
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
