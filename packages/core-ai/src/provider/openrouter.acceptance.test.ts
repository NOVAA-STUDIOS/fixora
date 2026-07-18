import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Finding } from '@fixora/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildContext } from '../context/context-builder.js';
import { prepareRequest } from '../pipeline/prepare.js';
import { parseRepairOutput } from '../profiles/schemas.js';

import { createOpenRouterProvider, type FetchLike } from './openrouter.js';
import type { ProviderEvent } from './types.js';

/**
 * BYOK acceptance over a REAL socket (Beta Phase F). A local server speaks the OpenRouter wire format —
 * chunked SSE, split across writes — and the *real* adapter fetches it, parses the stream, and yields
 * deltas + usage. This exercises the whole transport (real fetch, real SSE chunking, real JSON-schema
 * round-trip) end to end; only the model behind it is local. The one thing this cannot cover is a real
 * LLM's answer quality — that is the user's own-key run (see docs/BETA-ACCEPTANCE.md).
 */

// A well-formed structured repair, streamed as several content deltas then a usage frame.
const REPAIR_JSON = JSON.stringify({
  repairedCode: 'export function greet(name: string): string {\n  return `hi ${name}`;\n}',
  rationale: 'Template literal instead of string concatenation.',
  confidence: 0.94,
});

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
    // Stream the JSON as content deltas, deliberately splitting one across two writes.
    const mid = Math.floor(REPAIR_JSON.length / 2);
    res.write(frame({ choices: [{ delta: { content: REPAIR_JSON.slice(0, mid) } }] }));
    res.write(`data: {"choices":[{"delta":{"content":${JSON.stringify(REPAIR_JSON.slice(mid))}`);
    res.write('}}]}\n\n'); // the tail of the previous SSE line arrives in a later write
    res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1200, completion_tokens: 40 } }));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${String(port)}/v1/chat/completions`;
});

afterAll(() => {
  server.close();
});

const FILE = `export function greet(name: string): string {
  const msg = 'hi ' + name;
  return msg;
}
`;

const FINDING: Finding = {
  id: 'f1',
  source: 'eslint',
  ruleId: 'prefer-template',
  severity: 'warning',
  category: 'maintainability',
  location: { file: 'src/greet.ts', startLine: 2, startCol: 3, endLine: 2, endCol: 27 },
  message: 'Prefer template literals.',
  evidence: { snippet: "const msg = 'hi ' + name;", relatedLocations: [], toolOutput: {} },
  fixable: true,
  confidence: 1,
};

describe('BYOK acceptance: real OpenRouter SSE over a socket', () => {
  it('gates, streams, and parses a schema-valid repair end to end', async () => {
    // Real fetch to the local server, keeping the adapter's own headers/body/signal.
    const fetchImpl: FetchLike = (_endpoint, init) => fetch(url, init);
    const provider = createOpenRouterProvider({ apiKey: 'sk-or-test', fetchImpl });

    const context = buildContext({
      filePath: 'src/greet.ts',
      language: 'typescript',
      fileContent: FILE,
      finding: FINDING,
      target: { symbolName: 'greet', startLine: 1, endLine: 4 },
    });

    // The gate runs before the request is built — the real pipeline path.
    const prepared = prepareRequest('repair', context, { model: 'anthropic/claude-3.5-sonnet' });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const events: ProviderEvent[] = [];
    for await (const event of provider.stream(prepared.request, new AbortController().signal)) {
      events.push(event);
    }

    const text = events
      .filter((e): e is Extract<ProviderEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toEqual({ type: 'usage', inputTokens: 1200, outputTokens: 40, cachedTokens: 0 });

    const parsed = parseRepairOutput(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.repairedCode).toContain('`hi ${name}`');
    expect(parsed.value.confidence).toBe(0.94);
  });
});
