import {
  contracts,
  err,
  ok,
  type Channel,
  type FixoraError,
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
 * ~120 lines, no tRPC. The dependency would buy us type safety we already have from zod plus
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
 * The envelope every invocation arrives in. It is validated before the channel name is even
 * trusted, because a channel name is itself attacker-controlled input.
 */
type Envelope = { requestId: unknown; payload: unknown };

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'requestId' in value && 'payload' in value;
}

export function mountRouter(): void {
  for (const channel of Object.keys(contracts) as Channel[]) {
    ipcMain.handle(channel, async (_event, raw: unknown): Promise<Result<unknown>> => {
      const requestId =
        isEnvelope(raw) && typeof raw.requestId === 'string' ? raw.requestId : 'unknown';

      const handler = registry[channel];
      if (handler === undefined) {
        // A declared channel with no handler is a programming error, not a user condition.
        return err(
          fail('IPC_HANDLER_FAILED', requestId, 'This action is not available in this build.'),
        );
      }

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
            'Something went wrong handling that action. Retrying usually works; if it does not, ' +
              'open Help → Open Logs and include the request id.',
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

function contractViolation(requestId: string): FixoraError {
  return fail(
    'IPC_CONTRACT_VIOLATION',
    requestId,
    'Fixora rejected an internal message that did not match its contract. This is a bug in ' +
      'Fixora, not something you did.',
  );
}

function fail(code: FixoraError['code'], requestId: string, message: string): FixoraError {
  return {
    code,
    message,
    // Standards §5 / TDD §9: every error a human sees names the next step.
    action: { type: 'retry', label: 'Try again' },
    requestId,
  };
}
