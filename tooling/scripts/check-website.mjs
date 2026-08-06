#!/usr/bin/env node
// Refuses to let the website ship with an unresolved placeholder or a missing asset.
//
// The download button is the one control on the page that has to work — a visitor who clicks it and
// gets a 404 does not come back. "Remember to replace DOWNLOAD_URL" is not a control; this is. It
// runs in CI, so the site cannot be deployed half-configured.
//
// Run: node tooling/scripts/check-website.mjs
import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const siteDir = join(root, 'website');

/** Tokens the owner must replace before publishing, with what each one is for. */
const PLACEHOLDERS = {
  DOWNLOAD_URL: 'the Windows installer link (a published GitHub release asset)',
  STRIPE_URL: 'the Stripe Payment Link for the supporter license',
  FORM_ACTION: 'the email-capture endpoint',
  DOCS_URL: 'the hosted user guide',
  ISSUES_URL: 'the issue tracker',
};

/** Assets referenced by the page that must actually exist in the deployed directory. */
const REQUIRED_ASSETS = [
  'screenshots/01-problems-repair.png',
  'screenshots/02-diff-view.png',
  'screenshots/03-files-details.png',
  'screenshots/04-home-screen.png',
  'screenshots/05-settings-providers.png',
  'privacy.html',
  '.well-known/security.txt',
];

const problems = [];

const htmlFiles = (await readdir(siteDir, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && e.name.endsWith('.html'))
  .map((e) => join(e.parentPath ?? e.path, e.name));

for (const file of htmlFiles) {
  const text = readFileSync(file, 'utf8');
  for (const [token, purpose] of Object.entries(PLACEHOLDERS)) {
    // Only count it as unresolved where it is actually used as a value, not where the comment at
    // the top of the file explains what the token is for.
    const used = new RegExp(`(?:href|action|src)="${token}"`).test(text);
    if (used) {
      problems.push(`${file}: still points at ${token} — set it to ${purpose}.`);
    }
  }
}

for (const asset of REQUIRED_ASSETS) {
  if (!existsSync(join(siteDir, asset))) {
    problems.push(
      `website/${asset} is referenced by the site but does not exist. ` +
        (asset.startsWith('screenshots/')
          ? 'Capture it against the sample project — never against a real repository, since a ' +
            'screenshot of private code is a source-code leak.'
          : 'Add it before deploying.'),
    );
  }
}

if (problems.length > 0) {
  console.error('\nThe website is not ready to deploy:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error(`\n${problems.length} blocker(s). See docs/RELEASE-CHECKLIST.md.\n`);
  process.exit(1);
}

console.log('website: no unresolved placeholders, all referenced assets present.');
