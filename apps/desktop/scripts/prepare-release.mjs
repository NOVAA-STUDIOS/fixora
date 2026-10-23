import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packagePath = join(scriptDir, '..', 'package.json');
const versionTagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const signingEnvironment = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'AZURE_TRUSTED_SIGNING_ACCOUNT',
  'AZURE_TRUSTED_SIGNING_PROFILE',
  'AZURE_TRUSTED_SIGNING_PUBLISHER',
];

export function validateReleaseEnvironment(env) {
  if (env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error('Production release requires a Git tag ref.');
  }

  const match = versionTagPattern.exec(env.GITHUB_REF_NAME ?? '');
  if (!match) {
    throw new Error('Release tag must be vMAJOR.MINOR.PATCH with an optional semver suffix.');
  }

  const missing = signingEnvironment.filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === '',
  );
  if (missing.length > 0 && missing.length < signingEnvironment.length) {
    throw new Error(
      `Incomplete signing configuration; either provide all signing values or omit them: ${missing.join(', ')}.`,
    );
  }
  if (missing.length === signingEnvironment.length && match[0] !== 'v1.2.26') {
    throw new Error(
      'Signing configuration is required for production releases other than v1.2.26.',
    );
  }

  return {
    version: match[0].slice(1),
    signingMode: missing.length === signingEnvironment.length ? 'unsigned' : 'signed',
  };
}

function prepareRelease(env = process.env) {
  const { version, signingMode } = validateReleaseEnvironment(env);
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (pkg.name !== '@fixora/desktop') {
    throw new Error('Refusing to set release version on an unexpected package manifest.');
  }
  pkg.version = version;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  if (env.GITHUB_OUTPUT) {
    writeFileSync(env.GITHUB_OUTPUT, `version=${version}\nsigning=${signingMode}\n`, {
      encoding: 'utf8',
      flag: 'a',
    });
  }
  console.log(`Release preflight passed for ${env.GITHUB_REF_NAME}; signing mode: ${signingMode}.`);
}

try {
  if (process.argv.includes('--validate-only')) {
    const { version, signingMode } = validateReleaseEnvironment(process.env);
    console.log(
      `Release preflight passed for ${process.env.GITHUB_REF_NAME} (${version}); signing mode: ${signingMode}.`,
    );
  } else {
    prepareRelease();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Production release preflight failed.');
  process.exitCode = 1;
}
