// REAL-API acceptance probe for release blocker B4. Not part of the app, not part of CI.
//
// Everything Fixora's AI path does has, until now, been verified against a mock server written from
// the same reading of the docs that produced the shipped 404. This talks to OpenRouter for real,
// using the key already configured in the app.
//
// It runs under Electron because that is the only way to decrypt the stored key: safeStorage wraps
// DPAPI, and the ciphertext is bound to this Windows user. The plaintext is held in a local, passed
// to the provider, and never printed, logged or written — the same contract as ai-service.ts.
//
//   pnpm --filter @fixora/desktop ai:acceptance
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { app, safeStorage } = require('electron');

// Step tracing to a file. Electron on Windows does not forward a GUI process's stdout to the shell
// that launched it, so without this a failure anywhere in here is indistinguishable from a hang.
const TRACE = join(__dirname, '..', 'release', 'ai-acceptance.log');
function trace(message) {
  try {
    require('node:fs').mkdirSync(join(__dirname, '..', 'release'), { recursive: true });
    require('node:fs').appendFileSync(TRACE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* tracing must never be the thing that fails the run */
  }
}

// Same relaunch dance as make-icon.cjs: ELECTRON_RUN_AS_NODE strips the GUI bindings, and safeStorage
// is one of them.
if (app === undefined) {
  if (process.env.FIXORA_AI_RELAUNCHED === '1') {
    console.error('ai-acceptance: electron has no safeStorage bindings after relaunch.');
    process.exit(1);
  }
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, FIXORA_AI_RELAUNCHED: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  process.exit(spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' }).status ?? 1);
}

// Adopt the app's own profile *before* anything touches safeStorage. On Windows, Electron encrypts
// through Chromium's OSCrypt: a random key is generated per profile, DPAPI-protected, and stored in
// that profile's `Local State`. So decryption is bound to the userData directory, not just to the OS
// user — a probe running as the default "Electron" profile gets a different key and fails with the
// generic "Error while decrypting the ciphertext". Matching the name matches the profile.
//
// This is also the honest reason the key never has to leave the machine to be tested: the harness
// steps into Fixora's identity rather than extracting Fixora's secret.
app.setName('@fixora/desktop');
app.setPath('userData', join(app.getPath('appData'), '@fixora', 'desktop'));

const CREDENTIALS = join(app.getPath('userData'), 'ai-credentials.json');

function loadKeyAndModel() {
  const raw = JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
  if (typeof raw.keyEnc !== 'string' || raw.keyEnc === '') {
    throw new Error('No API key is configured in Fixora. Open Settings → AI and add one.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage reports encryption unavailable — cannot decrypt the stored key.');
  }
  return {
    key: safeStorage.decryptString(Buffer.from(raw.keyEnc, 'base64')),
    model: raw.model,
  };
}

/** Streams one real chat completion and returns the assembled text plus timing. */
async function callProvider({ key, model, messages, maxOutputTokens = 900 }) {
  const started = Date.now();
  trace('request -> ' + model);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    // A hung provider must not hang the harness. The app has its own abort path; this is the
    // harness's own guard so a stalled stream is reported as a stall rather than a silence.
    signal: AbortSignal.timeout(120000),
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'http-referer': 'https://fixora.dev',
      'x-title': 'Fixora',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxOutputTokens,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, status: response.status, body: body.slice(0, 400), ms: Date.now() - started };
  }

  // Same SSE assembly the adapter performs, so a framing difference would show up here too.
  let text = '';
  let usage = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue; // OpenRouter interleaves ": OPENROUTER PROCESSING" comments
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') text += delta;
      if (chunk.usage) usage = chunk.usage;
    }
  }
  return { ok: true, status: response.status, text, usage, ms: Date.now() - started };
}

module.exports = { loadKeyAndModel, callProvider, CREDENTIALS };

// Electron on Windows does not reliably forward a GUI process's stdout to the launching shell, so
// results go to a file the caller reads. Nothing sensitive is written — never the key.
const REPORT = join(__dirname, '..', 'release', 'ai-acceptance.json');

function writeReport(payload) {
  require('node:fs').mkdirSync(join(__dirname, '..', 'release'), { recursive: true });
  require('node:fs').writeFileSync(REPORT, JSON.stringify(payload, null, 2));
}

// No `require.main === module` guard: Electron does not set `require.main` to the entry script, so
// that check is silently false and the process idles forever with no window and nothing to do.
{
  (async () => {
    trace('boot');
    await app.whenReady(); // safeStorage is only guaranteed bound after ready
    trace('ready');
    const { key, model } = loadKeyAndModel();
    trace(`key decrypted, model=${model}`);
    const result = await callProvider({
      key,
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
      maxOutputTokens: 16,
    });
    writeReport({ probe: 'connectivity', model, ...result, text: result.text?.trim() });
    app.exit(result.ok ? 0 : 1);
  })().catch((error) => {
    writeReport({ probe: 'connectivity', ok: false, error: error.message });
    app.exit(1);
  });
}
