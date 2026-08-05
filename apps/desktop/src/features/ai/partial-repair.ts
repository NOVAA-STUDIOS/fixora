/**
 * The repaired code, pulled out of a JSON response that has not finished arriving.
 *
 * Repair asks the model for `{ repairedCode, rationale, confidence }`, and until the closing brace
 * lands none of it parses — so the panel showed a spinner for the whole call while the bytes were in
 * fact already streaming past. Explain streamed and felt fast; Repair blocked and felt broken, for no
 * reason other than its response being structured.
 *
 * This reads the value of `repairedCode` out of a truncated buffer, decoding the JSON string escapes
 * as it goes and stopping wherever the text currently ends. It is deliberately a reader, not a
 * parser: it recovers nothing else, validates nothing, and its output NEVER reaches the repair
 * pipeline. `parseRepairOutput` still owns the real result, from the complete response. This is a
 * preview and is treated as one — no patch, no diff, no Accept comes from it.
 */
const KEY = '"repairedCode"';

/** Escapes JSON defines. Anything else after a backslash is passed through as itself. */
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export function partialRepairedCode(buffer: string): string {
  const keyAt = buffer.indexOf(KEY);
  if (keyAt === -1) return '';

  // Find the opening quote of the VALUE — past the key, past the colon and any whitespace.
  let i = keyAt + KEY.length;
  while (i < buffer.length && buffer[i] !== ':') i += 1;
  i += 1;
  while (i < buffer.length && /\s/.test(buffer[i] ?? '')) i += 1;
  if (buffer[i] !== '"') return '';
  i += 1;

  let out = '';
  while (i < buffer.length) {
    const char = buffer[i] ?? '';
    if (char === '"') break; // value complete
    if (char !== '\\') {
      out += char;
      i += 1;
      continue;
    }
    // A trailing backslash is a half-arrived escape. Stopping here rather than guessing keeps the
    // preview from flashing a stray character that the next chunk turns into a newline.
    const next = buffer[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = buffer.slice(i + 2, i + 6);
      if (hex.length < 4) break; // incomplete \uXXXX — wait for the rest
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}
