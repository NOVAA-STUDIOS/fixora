import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { buildContext } from '../context/context-builder.js';

import { buildProviderRequest, profileWantsStructuredOutput } from './profiles.js';

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
  repair: 'ai-required',
  confidence: 1,
};

const context = buildContext({
  filePath: 'src/greet.ts',
  language: 'typescript',
  fileContent: FILE,
  finding: FINDING,
  target: { symbolName: 'greet', startLine: 1, endLine: 4 },
  conventions: ['test framework: vitest'],
});

describe('task profiles', () => {
  it('repair asks for schema-constrained JSON output and is low-temperature', () => {
    const request = buildProviderRequest('repair', context, { model: 'x', maxOutputTokens: 1000 });
    expect(request.responseSchema?.name).toBe('repair');
    expect(request.temperature).toBeLessThanOrEqual(0.2);
    expect(request.maxOutputTokens).toBe(1000);
    expect(profileWantsStructuredOutput('repair')).toBe(true);
  });

  it('test asks for schema-constrained JSON output', () => {
    const request = buildProviderRequest('test', context, { model: 'x' });
    expect(request.responseSchema?.name).toBe('test');
    expect(profileWantsStructuredOutput('test')).toBe(true);
  });

  it('explain streams prose — no response schema', () => {
    const request = buildProviderRequest('explain', context, { model: 'x' });
    expect(request.responseSchema).toBeUndefined();
    expect(profileWantsStructuredOutput('explain')).toBe(false);
  });

  it('every request is grounded: the user message carries the finding and the target symbol', () => {
    const request = buildProviderRequest('repair', context, { model: 'x' });
    const user = request.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('prefer-template'); // the grounded finding
    expect(user?.content).toContain('export function greet'); // the exact target
    expect(user?.content).toContain('test framework: vitest'); // conventions
    // System prompt forbids whole-file rewrites.
    const system = request.messages.find((m) => m.role === 'system');
    expect(system?.content.toLowerCase()).toContain('only the target symbol');
  });
});

/**
 * The language rule layer — TS2345-on-a-.js-file reproduction.
 *
 * Recorded twice in production against `auth.js:38`: tsc type-checks JavaScript via `checkJs`, so
 * the finding arrived phrased in TypeScript ("Argument of type 'any' is not assignable to parameter
 * of type 'never'"), and the model answered in TypeScript — `token as never`, then
 * `(user.tokens as any[])`. Neither is valid JavaScript; the parser gate rejected both and Apply
 * stayed disabled. The prompt had said `Language: javascript` three times — a fact, never a rule.
 */
const JS_FILE = `function login(user, token) {
  user.tokens.push(token);
  return user;
}
`;

const TS2345_ON_JS: Finding = {
  id: 'f-ts2345',
  source: 'tsc',
  ruleId: 'TS2345',
  severity: 'error',
  category: 'correctness',
  location: { file: 'auth.js', startLine: 2, startCol: 22, endLine: 2, endCol: 22 },
  message: "Argument of type 'any' is not assignable to parameter of type 'never'.",
  evidence: { snippet: '  user.tokens.push(token);', relatedLocations: [], toolOutput: {} },
  fixable: false,
  repair: 'ai-required',
  confidence: 1,
};

function jsRequest(file = 'auth.js') {
  const ctx = buildContext({
    filePath: file,
    language: 'javascript',
    fileContent: JS_FILE,
    finding: { ...TS2345_ON_JS, location: { ...TS2345_ON_JS.location, file } },
    target: { symbolName: 'login', startLine: 1, endLine: 4 },
  });
  return buildProviderRequest('repair', ctx, { model: 'x' });
}

describe('language rules — JavaScript', () => {
  const userMsg = (r: ReturnType<typeof jsRequest>) =>
    r.messages.find((m) => m.role === 'user')?.content ?? '';
  const systemMsg = (r: ReturnType<typeof jsRequest>) =>
    r.messages.find((m) => m.role === 'system')?.content ?? '';

  it('forbids the exact TypeScript constructs the model actually emitted', () => {
    const msg = userMsg(jsRequest());
    expect(msg).toContain('Valid syntax for this file');
    expect(msg).toContain('ECMAScript only');
    // The two shapes recorded in production, named explicitly.
    expect(msg).toContain('`x as T`');
    expect(msg).toContain('`<T>x`');
    expect(msg).toContain('interface');
    expect(msg).toContain('enum');
  });

  it('offers a legal alternative, so the model is not cornered into a no-op', () => {
    expect(userMsg(jsRequest())).toContain('@type');
  });

  it('places the rule BEFORE the finding — proximity is what the fix turns on', () => {
    const msg = userMsg(jsRequest());
    expect(msg.indexOf('Do not emit:')).toBeLessThan(msg.indexOf('Finding to address:'));
    expect(msg.indexOf('Language: javascript')).toBeLessThan(msg.indexOf('Do not emit:'));
  });

  it('states the precedence rule once, in the shared system prompt, not per language', () => {
    const sys = systemMsg(jsRequest());
    expect(sys).toContain('the language of the FILE wins');
    // The shared prompt must stay language-agnostic — no dialect names leak into it.
    expect(sys).not.toContain('ECMAScript');
    expect(sys).not.toContain('@type');
  });

  it('applies to .jsx too — it is JavaScript by grammar', () => {
    expect(userMsg(jsRequest('Component.jsx'))).toContain('ECMAScript only');
  });

  it('adds NOTHING for TypeScript — a superset needs no exclusions', () => {
    const msg = buildProviderRequest('repair', context, { model: 'x' }).messages.find(
      (m) => m.role === 'user',
    )?.content;
    expect(msg).not.toContain('Valid syntax for this file');
    expect(msg).not.toContain('Do not emit:');
  });
});
