import type { ProviderEvent } from '../types.js';

/**
 * Server-sent-event line reading, shared by every streaming adapter.
 *
 * Extracted when Anthropic and Gemini arrived. All three protocols disagree about what an event
 * MEANS — OpenAI sends `choices[].delta.content`, Anthropic sends typed `content_block_delta`
 * frames, Gemini sends whole `candidates[]` objects — but they agree completely on the transport:
 * UTF-8 chunks, split on newlines, `data:` prefixed payloads. Copying that loop three times would
 * mean three places to get chunk-boundary handling wrong, and a multi-byte character split across
 * two reads is exactly the bug that only appears in production.
 *
 * The caller supplies the meaning; this owns the plumbing.
 */

/** Turn one already-trimmed SSE line into zero or more provider events. */
export type LineHandler = (line: string) => Iterable<ProviderEvent>;

/**
 * Read an SSE body to completion, yielding whatever `handleLine` makes of each line.
 *
 * `decoder.decode(..., {stream: true})` is what makes a multi-byte character split across two
 * network reads survive — without it, a chunk boundary inside a UTF-8 sequence corrupts the text,
 * and for a tool that writes the result into someone's source file that corruption is silent.
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  handleLine: LineHandler,
  signal: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value as Uint8Array, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        yield* handleLine(line);
      }
    }
  } catch (error) {
    // A cancelled stream is not an error (AI-Pipeline §6) — the user asked for it to stop.
    if (signal.aborted) return;
    yield {
      type: 'error',
      retryable: true,
      providerCode: 'STREAM',
      message: error instanceof Error ? error.name : 'stream error',
    };
  }
}

/** The JSON payload of a `data:` line, or null for comments, keep-alives and terminators. */
export function sseData(line: string, terminator = '[DONE]'): string | null {
  if (!line.startsWith('data:')) return null;
  const data = line.slice('data:'.length).trim();
  if (data === '' || data === terminator) return null;
  return data;
}
