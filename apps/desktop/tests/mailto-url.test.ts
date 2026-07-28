import { describe, expect, it } from 'vitest';

import { buildMailtoUrl } from '../electron/main/services/mail/mailto-url.js';

/**
 * `buildMailtoUrl` is built entirely from `URL`/`URLSearchParams` — these tests exist to prove the
 * one correction on top of that (space encoded as `%20`, not `URLSearchParams`'s default `+`) is
 * exact, and that unicode/emoji/line-breaks/special characters all round-trip correctly.
 */
describe('buildMailtoUrl', () => {
  it('produces the standard mailto:<address>?subject=...&body=... shape', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(url.startsWith('mailto:a@b.com?')).toBe(true);
  });

  it('encodes spaces as %20, never a literal + (RFC 6068, not application/x-www-form-urlencoded)', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'two words', body: 'three words here' });
    expect(url).toContain('subject=two%20words');
    expect(url).toContain('body=three%20words%20here');
    expect(url).not.toContain('+');
  });

  it('preserves a literal + in the input by encoding it as %2B, never as a space', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'a+b', body: '1+1=2' });
    expect(url).toContain('subject=a%2Bb');
    expect(url).toContain('body=1%2B1%3D2');
  });

  it('encodes a literal % as %25 so it is never mistaken for a percent-escape', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: '100% done', body: '50% off' });
    expect(url).toContain('subject=100%25%20done');
  });

  it('encodes line breaks in the body as %0A', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'x', body: 'Line one\nLine two' });
    expect(url).toContain('Line%20one%0ALine%20two');
    expect(url).not.toContain('\n');
  });

  it('encodes unicode characters correctly', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'Café', body: 'naïve résumé' });
    expect(url).toContain(encodeURIComponent('Café').replace(/\+/g, '%20'));
    expect(decodeURIComponent(new URL(url).search.match(/body=([^&]*)/)![1]!)).toBe('naïve résumé');
  });

  it('encodes emoji correctly and they round-trip losslessly', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'x', body: 'Great idea 🎉🚀' });
    const bodyParam = new URL(url).search.match(/body=([^&]*)/)![1]!;
    expect(decodeURIComponent(bodyParam)).toBe('Great idea 🎉🚀');
  });

  it('encodes special/reserved URL characters (&, =, ?, #) so they cannot break out of the query string', () => {
    const url = buildMailtoUrl({ to: 'a@b.com', subject: 'a&b=c?d#e', body: 'x' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('subject')).toBe('a&b=c?d#e'); // round-trips exactly
  });

  it('round-trips a long subject and body without corruption', () => {
    const subject = 'S'.repeat(900);
    const body = 'B'.repeat(7000);
    const url = buildMailtoUrl({ to: 'a@b.com', subject, body });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('subject')).toBe(subject);
    expect(parsed.searchParams.get('body')).toBe(body);
  });

  it('never manually concatenates the recipient/subject/body into an ad-hoc string — the result always re-parses as a valid mailto: URL', () => {
    const url = buildMailtoUrl({
      to: 'novaa.support.team@gmail.com',
      subject: 'Weird & tricky = subject?',
      body: 'Body with\nnewlines, emoji 🎉, unicode café, and a literal + sign',
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('mailto:');
    expect(parsed.pathname).toBe('novaa.support.team@gmail.com');
  });
});
