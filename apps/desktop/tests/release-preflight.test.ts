import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/prepare-release.mjs');
const validEnvironment = {
  ...process.env,
  GITHUB_REF_TYPE: 'tag',
  GITHUB_REF_NAME: 'v1.2.26',
  AZURE_TENANT_ID: 'tenant-test',
  AZURE_CLIENT_ID: 'client-test',
  AZURE_CLIENT_SECRET: 'secret-test-value',
  AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://test.codesigning.azure.net',
  AZURE_TRUSTED_SIGNING_ACCOUNT: 'account-test',
  AZURE_TRUSTED_SIGNING_PROFILE: 'profile-test',
  AZURE_TRUSTED_SIGNING_PUBLISHER: 'NOVAA Studios',
};

function validate(env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, '--validate-only'], {
    encoding: 'utf8',
    env,
  });
}

describe('production release preflight', () => {
  it('rejects non-semver or non-tag refs', () => {
    const result = validate({ ...validEnvironment, GITHUB_REF_NAME: 'release-latest' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Release tag must be');
  });

  it('fails closed when signing credentials or account configuration are missing', () => {
    const env: NodeJS.ProcessEnv = { ...validEnvironment };
    delete env['AZURE_CLIENT_SECRET'];
    delete env['AZURE_TRUSTED_SIGNING_PROFILE'];
    const result = validate(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AZURE_CLIENT_SECRET');
    expect(result.stderr).toContain('AZURE_TRUSTED_SIGNING_PROFILE');
    expect(result.stderr).not.toContain('secret-test-value');
  });

  it('allows v1.2.26 unsigned only when all signing configuration is absent', () => {
    const env: NodeJS.ProcessEnv = { ...validEnvironment };
    for (const name of [
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_TRUSTED_SIGNING_ENDPOINT',
      'AZURE_TRUSTED_SIGNING_ACCOUNT',
      'AZURE_TRUSTED_SIGNING_PROFILE',
      'AZURE_TRUSTED_SIGNING_PUBLISHER',
    ]) {
      delete env[name];
    }
    const result = validate(env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('v1.2.26 (1.2.26)');
    expect(result.stdout).toContain('signing mode: unsigned');
    expect(result.stdout).not.toContain('secret-test-value');
  });

  it('keeps later production releases fail-closed when signing configuration is absent', () => {
    const env: NodeJS.ProcessEnv = { ...validEnvironment, GITHUB_REF_NAME: 'v1.2.27' };
    for (const name of [
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_TRUSTED_SIGNING_ENDPOINT',
      'AZURE_TRUSTED_SIGNING_ACCOUNT',
      'AZURE_TRUSTED_SIGNING_PROFILE',
      'AZURE_TRUSTED_SIGNING_PUBLISHER',
    ]) {
      delete env[name];
    }
    const result = validate(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Signing configuration is required');
  });

  it('accepts complete signing configuration without printing secrets', () => {
    const result = validate(validEnvironment);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('v1.2.26 (1.2.26)');
    expect(result.stdout).toContain('signing mode: signed');
    expect(result.stdout).not.toContain('secret-test-value');
  });
});
