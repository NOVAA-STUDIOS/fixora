import { describe, expect, it } from 'vitest';

import { buildGmailComposeUrl } from '../electron/main/services/mail/gmail-compose-url.js';

describe('buildGmailComposeUrl', () => {
  it('produces the required Gmail compose base with view=cm&fs=1', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(url.startsWith('https://mail.google.com/mail/?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('view')).toBe('cm');
    expect(parsed.searchParams.get('fs')).toBe('1');
  });

  it('appends to, su, and body as query parameters', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'Hi there', body: 'Hello world' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('to')).toBe('a@b.com');
    expect(parsed.searchParams.get('su')).toBe('Hi there');
    expect(parsed.searchParams.get('body')).toBe('Hello world');
  });

  it('encodes spaces (standard query-string + is correct here, unlike mailto:)', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'two words', body: 'three words here' });
    expect(url).toContain('su=two+words');
    expect(url).toContain('body=three+words+here');
  });

  it('encodes unicode correctly', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'Café suggestion', body: 'naïve résumé' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('su')).toBe('Café suggestion');
    expect(parsed.searchParams.get('body')).toBe('naïve résumé');
  });

  it('encodes emoji correctly and they round-trip losslessly', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'x', body: 'Great idea 🎉🚀' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe('Great idea 🎉🚀');
  });

  it('encodes line breaks in the body', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'x', body: 'Line one\nLine two' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe('Line one\nLine two');
    expect(url).not.toContain('Line one\nLine two'); // it must be encoded in the raw string
  });

  it('encodes special/reserved characters (&, =, ?, #, %, +) without corrupting the URL', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'a&b=c?d#e%f+g', body: 'x' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('su')).toBe('a&b=c?d#e%f+g');
  });

  it('handles an empty body without error', () => {
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject: 'Just a subject', body: '' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe('');
    expect(parsed.searchParams.get('su')).toBe('Just a subject');
  });

  it('round-trips a long subject and long body without truncation or corruption', () => {
    const subject = 'S'.repeat(900);
    const body = 'B'.repeat(7000);
    const url = buildGmailComposeUrl({ to: 'a@b.com', subject, body });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('su')).toBe(subject);
    expect(parsed.searchParams.get('body')).toBe(body);
  });

  it('never manually concatenates the recipient/subject/body — the result always re-parses as a valid https URL under mail.google.com', () => {
    const url = buildGmailComposeUrl({
      to: 'novaa.support.team@gmail.com',
      subject: 'Weird & tricky = subject?',
      body: 'Body with\nnewlines, emoji 🎉, unicode café, and a literal + sign',
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('mail.google.com');
  });
});
