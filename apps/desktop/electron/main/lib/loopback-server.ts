import { createServer } from 'node:http';

/**
 * The loopback half of PKCE + loopback OAuth (RFC 8252). Listens on `127.0.0.1` only — never
 * `0.0.0.0` — on a port the OS assigns (`port: 0`), so nothing on the network but this machine's
 * own loopback interface can ever reach it, and no fixed port can collide with another app or be
 * probed for in advance.
 *
 * One callback, then done: the server closes itself the instant it has read `code`/`state` off
 * the single request it exists to receive, and a 5-minute timeout closes it regardless if the
 * user never completes the browser round trip.
 */

const TIMEOUT_MS = 5 * 60 * 1000;

export interface LoopbackCallback {
  readonly code: string;
  readonly state: string;
}

export interface LoopbackServer {
  readonly port: number;
  waitForCallback: () => Promise<LoopbackCallback>;
}

const CALLBACK_HTML =
  '<!doctype html><html><body style="font-family:sans-serif">Authentication complete. You can close this tab.</body></html>';

export function startLoopbackServer(): Promise<LoopbackServer> {
  const server = createServer();
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;

  const waitForCallback = (): Promise<LoopbackCallback> =>
    new Promise((resolveCallback, rejectCallback) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        server.close();
        rejectCallback(new Error('Timed out waiting for the OAuth callback.'));
      }, TIMEOUT_MS);

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_HTML);

        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Closed after responding, not before — closing first can cut the response off before the
        // browser tab finishes rendering it.
        server.close();

        if (code === null || state === null) {
          rejectCallback(new Error('OAuth callback was missing code or state.'));
          return;
        }
        resolveCallback({ code, state });
      });

      server.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectCallback(error);
      });
    });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Loopback server did not report a port.'));
        return;
      }
      resolve({ port: address.port, waitForCallback });
    });
  });
}
