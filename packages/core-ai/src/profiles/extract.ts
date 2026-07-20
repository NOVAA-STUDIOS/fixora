/**
 * Recovering JSON from a model response that is nearly-JSON.
 *
 * The original parser was `JSON.parse(raw)` and nothing else, on the stated principle that scraping
 * markdown fences is "silent, undetectable corruption in a system that writes to people's source
 * files". That principle is right, and this module does not abandon it — it satisfies it properly.
 *
 * The distinction the original code missed is between *guessing at content* and *removing a wrapper*.
 * Stripping a ```json fence does not change one character of the JSON inside it; it changes where the
 * JSON starts. Inventing a missing field would be corruption. Unwrapping is not.
 *
 * What makes it safe is that recovery is **recorded, not hidden**. Every step that fired is reported
 * in `recovery`, so a caller can log it, a diagnostics panel can show it, and nobody has to wonder
 * whether the parse was clean. The thing the original comment feared — an undetectable repair — is
 * exactly what `recovery` prevents.
 *
 * Ordered strictly cheapest-and-safest first. The first strategy that yields valid JSON wins, so a
 * clean response never touches any of the riskier ones.
 */

export type RecoveryStep =
  /** Parsed as-is. No recovery. */
  | 'none'
  /** Leading/trailing whitespace only. */
  | 'trimmed'
  /** A markdown code fence (```json … ```) was removed. */
  | 'code-fence'
  /** Prose surrounded the object; the outermost balanced {...} was extracted. */
  | 'balanced-object'
  /** Trailing commas before } or ] were removed. */
  | 'trailing-comma'
  /** Smart quotes were normalised to ASCII quotes. */
  | 'smart-quotes';

export type ExtractResult =
  | { ok: true; json: unknown; recovery: RecoveryStep[]; text: string }
  | { ok: false; reason: ExtractFailure; detail: string; text: string };

export type ExtractFailure =
  /** Nothing was returned at all. */
  | 'empty'
  /** No `{` anywhere — the model answered in prose, so there is nothing to recover. */
  | 'no-json-object'
  /** A `{` with no matching `}` — the response stopped mid-object. */
  | 'truncated'
  /** Balanced braces, but still not parseable after every recovery step. */
  | 'malformed-json';

const tryParse = (text: string): { ok: true; json: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Remove a ```json / ``` wrapper. Returns null when there is no fence, so the caller can skip it. */
function stripCodeFence(text: string): string | null {
  const fence = /^\s*```(?:json|JSON|js|javascript)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/.exec(text);
  return fence?.[1] ?? null;
}

/**
 * The outermost balanced `{…}`, honouring string literals and escapes.
 *
 * A regex cannot do this correctly — a `}` inside a string literal ends the match early, and
 * `repairedCode` is *source code*, which is exactly where braces-in-strings live. So it is a real
 * scanner, and the string/escape state is the whole point of it.
 */
function extractBalancedObject(text: string): { json: string | null; truncated: boolean } {
  const start = text.indexOf('{');
  if (start === -1) return { json: null, truncated: false };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { json: text.slice(start, i + 1), truncated: false };
    }
  }
  // Ran out of input with the object still open: the response was cut short.
  return { json: null, truncated: true };
}

/** `{"a": 1,}` → `{"a": 1}`. Only outside string literals. */
function removeTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === ',') {
      // Look ahead past whitespace for a closer.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
      const next = text[j];
      if (next === '}' || next === ']') continue; // drop the comma
    }
    out += ch;
  }
  return out;
}

/** Curly quotes are a real failure mode from models that "helpfully" prettify. Outside strings only. */
const normaliseSmartQuotes = (text: string): string =>
  text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

export function extractJson(raw: string): ExtractResult {
  const recovery: RecoveryStep[] = [];

  if (raw.trim().length === 0) {
    return {
      ok: false,
      reason: 'empty',
      detail: 'The model returned no content at all.',
      text: raw,
    };
  }

  // 1. As-is.
  const direct = tryParse(raw);
  if (direct.ok) return { ok: true, json: direct.json, recovery: ['none'], text: raw };

  // 2. Trimmed.
  const trimmed = raw.trim();
  const trimmedParse = tryParse(trimmed);
  if (trimmedParse.ok)
    return { ok: true, json: trimmedParse.json, recovery: ['trimmed'], text: trimmed };

  // 3. Markdown fence — the single most common wrapper, and a pure unwrap.
  let candidate = trimmed;
  const unfenced = stripCodeFence(trimmed);
  if (unfenced !== null) {
    recovery.push('code-fence');
    candidate = unfenced.trim();
    const parsed = tryParse(candidate);
    if (parsed.ok) return { ok: true, json: parsed.json, recovery, text: candidate };
  }

  // 4. Prose around an object ("Here is the fix: { … } Hope this helps!").
  const balanced = extractBalancedObject(candidate);
  if (balanced.truncated) {
    return {
      ok: false,
      reason: 'truncated',
      detail:
        'The response contains an opening "{" with no matching "}" — the model stopped mid-object. ' +
        'This is usually the output token limit being hit, not a malformed reply.',
      text: candidate,
    };
  }
  if (balanced.json === null) {
    return {
      ok: false,
      reason: 'no-json-object',
      detail:
        'The response contains no "{" anywhere, so there is no JSON object to recover — the model ' +
        'answered in prose instead of the requested format.',
      text: candidate,
    };
  }
  if (balanced.json !== candidate) {
    recovery.push('balanced-object');
    candidate = balanced.json;
    const parsed = tryParse(candidate);
    if (parsed.ok) return { ok: true, json: parsed.json, recovery, text: candidate };
  }

  // 5. Trailing commas.
  const decommaed = removeTrailingCommas(candidate);
  if (decommaed !== candidate) {
    recovery.push('trailing-comma');
    candidate = decommaed;
    const parsed = tryParse(candidate);
    if (parsed.ok) return { ok: true, json: parsed.json, recovery, text: candidate };
  }

  // 6. Smart quotes.
  const dequoted = normaliseSmartQuotes(candidate);
  if (dequoted !== candidate) {
    recovery.push('smart-quotes');
    candidate = dequoted;
    const parsed = tryParse(candidate);
    if (parsed.ok) return { ok: true, json: parsed.json, recovery, text: candidate };
  }

  const final = tryParse(candidate);
  return {
    ok: false,
    reason: 'malformed-json',
    detail: `The response looks like JSON but will not parse: ${final.ok ? 'unknown' : final.error}`,
    text: candidate,
  };
}
