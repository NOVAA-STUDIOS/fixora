export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export interface AnalysisIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix?: string;
}

export interface AnalysisResult {
  issues: AnalysisIssue[];
}

const PROMPT_INSTRUCTIONS =
  'You are a senior code reviewer. Find bugs, errors and warnings in the code below. ' +
  'Respond with ONLY a JSON object, no prose, no markdown fences, in this exact shape: ' +
  '{"issues":[{"line":<1-based line number>,"severity":"error"|"warning"|"info","message":"<what is wrong>","fix":"<suggested replacement code for that line, or omit if none>"}]}. ' +
  'If there are no issues, respond with {"issues":[]}.';

function buildPrompt(code: string, filePath: string): string {
  return `${PROMPT_INSTRUCTIONS}\n\nFile: ${filePath}\n\n\`\`\`\n${code}\n\`\`\``;
}

/** Pulls the JSON object out of a model response, tolerating stray prose or a markdown fence around
 *  it — models do not always follow "JSON only" exactly even when told to. */
function parseResult(raw: string): AnalysisResult {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (match === null) throw new Error('The model did not return a parseable JSON response.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('The model returned malformed JSON.');
  }

  const issuesRaw =
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { issues?: unknown }).issues)
      ? (parsed as { issues: unknown[] }).issues
      : [];

  const issues: AnalysisIssue[] = [];
  for (const entry of issuesRaw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const line = typeof e['line'] === 'number' ? e['line'] : null;
    const message = typeof e['message'] === 'string' ? e['message'] : null;
    if (line === null || message === null) continue;
    const severity = e['severity'] === 'error' || e['severity'] === 'info' ? e['severity'] : 'warning';
    const fix = typeof e['fix'] === 'string' && e['fix'] !== '' ? e['fix'] : undefined;
    issues.push(fix === undefined ? { line, severity, message } : { line, severity, message, fix });
  }
  return { issues };
}

export interface RepairResult {
  repairedCode: string;
  explanation: string;
}

function buildRepairPrompt(
  issue: { message: string; line: number; severity: string },
  filePath: string,
  code: string,
): string {
  return (
    'You are an expert code repair assistant. Repair this issue in the code. ' +
    'Return ONLY a JSON object, no prose, no markdown fences, in this exact shape: ' +
    '{"repairedCode":"<the full repaired file content>","explanation":"<what was wrong and what changed>"}. ' +
    `Issue: ${JSON.stringify(issue)}. File: ${filePath}. Code:\n\`\`\`\n${code}\n\`\`\``
  );
}

/** Same tolerant-extraction approach as `parseResult` — a model does not always answer JSON-only. */
function parseRepairResult(raw: string): RepairResult {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (match === null) throw new Error('The model did not return a parseable JSON response.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('The model returned malformed JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The model returned an unexpected response shape.');
  }
  const repairedCode = (parsed as Record<string, unknown>)['repairedCode'];
  const explanation = (parsed as Record<string, unknown>)['explanation'];
  if (typeof repairedCode !== 'string' || typeof explanation !== 'string') {
    throw new Error('The model response is missing repairedCode or explanation.');
  }
  return { repairedCode, explanation };
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  if (!response.ok) {
    throw new Error(`Provider returned ${String(response.status)}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (content === undefined) throw new Error('No content in provider response.');
  return content;
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic returned ${String(response.status)}: ${await response.text()}`);
  }
  const data = (await response.json()) as { content?: { text?: string }[] };
  const text = data.content?.[0]?.text;
  if (text === undefined) throw new Error('No content in Anthropic response.');
  return text;
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) {
    throw new Error(`Gemini returned ${String(response.status)}: ${await response.text()}`);
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) throw new Error('No content in Gemini response.');
  return text;
}

async function callProvider(apiKey: string, provider: AiProvider, model: string, prompt: string): Promise<string> {
  if (provider === 'anthropic') return callAnthropic(apiKey, model, prompt);
  if (provider === 'gemini') return callGemini(apiKey, model, prompt);
  if (provider === 'openai') return callOpenAiCompatible('https://api.openai.com/v1/chat/completions', apiKey, model, prompt);
  return callOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', apiKey, model, prompt, {
    'HTTP-Referer': 'https://fixora-opal.vercel.app',
    'X-Title': 'Fixora VS Code',
  });
}

/** Standalone analysis: calls the chosen provider directly with the user's own key — no Fixora
 *  desktop app involved. Used as the fallback when MCP is unavailable (extension.ts). */
export async function analyzeCode(
  code: string,
  filePath: string,
  apiKey: string,
  provider: AiProvider,
  model: string,
): Promise<AnalysisResult> {
  if (apiKey.trim() === '') {
    throw new Error('No API key configured. Run "Fixora: Setup API Key" first.');
  }
  const raw = await callProvider(apiKey, provider, model, buildPrompt(code, filePath));
  return parseResult(raw);
}

/** Standalone repair: same fallback role as `analyzeCode`, for the repair command. */
export async function repairIssue(
  issue: { message: string; line: number; severity: string },
  code: string,
  filePath: string,
  apiKey: string,
  provider: AiProvider,
  model: string,
): Promise<RepairResult> {
  if (apiKey.trim() === '') {
    throw new Error('No API key configured. Run "Fixora: Setup API Key" first.');
  }
  const raw = await callProvider(apiKey, provider, model, buildRepairPrompt(issue, filePath, code));
  return parseRepairResult(raw);
}

/** Standalone explain: same fallback role as `analyzeCode`, for the explain command. */
export async function explainIssue(
  issue: { message: string; line: number; rule?: string },
  code: string,
  apiKey: string,
  provider: AiProvider,
  model: string,
): Promise<string> {
  if (apiKey.trim() === '') {
    throw new Error('No API key configured. Run "Fixora: Setup API Key" first.');
  }
  const prompt =
    `Explain this code issue clearly for a developer. Issue: ${issue.message} ` +
    `(rule: ${issue.rule ?? 'unknown'}) in this code:\n\`\`\`\n${code}\n\`\`\`\n` +
    'Keep the explanation concise and actionable. Respond with plain text only, no JSON, no markdown fences.';
  return callProvider(apiKey, provider, model, prompt);
}
