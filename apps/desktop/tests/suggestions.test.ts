import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../electron/main/db/database.js';
import { createSuggestionRepository } from '../electron/main/suggestions/suggestion-repository.js';
import { createSuggestionService } from '../electron/main/suggestions/suggestion-service.js';
import { createSuggestionStorage } from '../electron/main/suggestions/suggestion-storage.js';

/**
 * Integration coverage for the whole Suggestion System main-process stack — storage, repository,
 * and service wired together against a REAL SQLite database (the same `openDatabase` main.ts uses),
 * not mocks. This is what proves the migration, the storage SQL, the repository's row↔domain
 * mapping, and the service's validate→persist orchestration actually work together, not just in
 * isolation.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixora-suggestions-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('suggestion storage + repository', () => {
  it('creates, lists (newest first), removes, and clears', () => {
    const { driver } = openDatabase({ dir });
    let clock = 1000;
    const repo = createSuggestionRepository(createSuggestionStorage(driver), () => clock);

    const first = repo.create({ category: 'feature', message: 'Add a dark theme' });
    expect(first.category).toBe('feature');
    expect(first.createdAt).toBe(1000);

    clock = 2000;
    const second = repo.create({ category: 'bug', message: 'Crash on save' });

    const listed = repo.list();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.id).toBe(second.id); // newest first
    expect(listed[1]?.id).toBe(first.id);

    repo.remove(first.id);
    expect(repo.list()).toHaveLength(1);

    repo.clear();
    expect(repo.list()).toEqual([]);
    driver.close();
  });

  it('survives a fresh database open (the migration actually created the table)', () => {
    const { driver, recovered } = openDatabase({ dir });
    expect(recovered).toBe(false);
    expect(() => driver.prepare('SELECT * FROM suggestions').all()).not.toThrow();
    driver.close();
  });

  it('findById returns the matching suggestion, or undefined when it does not exist', () => {
    const { driver } = openDatabase({ dir });
    const repo = createSuggestionRepository(createSuggestionStorage(driver));
    const created = repo.create({ category: 'bug', message: 'Crash on save' });

    expect(repo.findById(created.id)).toEqual(created);
    expect(repo.findById('does-not-exist')).toBeUndefined();

    repo.remove(created.id);
    expect(repo.findById(created.id)).toBeUndefined();
    driver.close();
  });
});

describe('suggestion service', () => {
  function makeService(
    clock: () => number = Date.now,
    env: { appVersion?: string; platform?: string } = {},
  ) {
    const { driver } = openDatabase({ dir });
    const service = createSuggestionService({
      repository: createSuggestionRepository(createSuggestionStorage(driver), clock),
      appVersion: env.appVersion ?? '1.2.3',
      platform: env.platform ?? 'win32',
    });
    return { service, driver };
  }

  it('submits a valid suggestion and persists it', () => {
    const { service, driver } = makeService();
    const created = service.submit({ category: 'improvement', message: 'Faster startup please' });
    expect(created.category).toBe('improvement');
    expect(service.list()).toHaveLength(1);
    driver.close();
  });

  it('rejects an invalid category with a UserFacingError naming the real reason', () => {
    const { service, driver } = makeService();
    expect(() => service.submit({ category: 'not-a-category', message: 'a fine message here' })).toThrow(
      UserFacingError,
    );
    expect(service.list()).toHaveLength(0);
    driver.close();
  });

  it('rejects a too-short message and never persists it', () => {
    const { service, driver } = makeService();
    try {
      service.submit({ category: 'other', message: 'short' });
      expect.unreachable('expected submit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UserFacingError);
      expect((error as UserFacingError).message).toContain('too short');
    }
    expect(service.list()).toHaveLength(0);
    driver.close();
  });

  it('trims the message before persisting (service delegates to the validator, not its own logic)', () => {
    const { service, driver } = makeService();
    service.submit({ category: 'other', message: '   padded suggestion text   ' });
    expect(service.list()[0]?.message).toBe('padded suggestion text');
    driver.close();
  });

  it('exports every suggestion as pretty-printed JSON, matching what list() returns', () => {
    let clock = 5000;
    const { service, driver } = makeService(() => clock);
    service.submit({ category: 'feature', message: 'Suggestion number one here' });
    clock = 6000;
    service.submit({ category: 'bug', message: 'Suggestion number two here' });

    const exported = JSON.parse(service.exportToJson()) as unknown[];
    expect(exported).toEqual(service.list());
    expect(service.exportToJson()).toContain('\n'); // pretty-printed, not minified
    driver.close();
  });

  it('remove and clear operate through the service exactly like the repository', () => {
    const { service, driver } = makeService();
    const a = service.submit({ category: 'other', message: 'first suggestion message' });
    service.submit({ category: 'other', message: 'second suggestion message' });
    service.remove(a.id);
    expect(service.list()).toHaveLength(1);
    service.clear();
    expect(service.list()).toEqual([]);
    driver.close();
  });

  describe('buildShareEmail (Sprint F1.1)', () => {
    it('composes the exact subject format and includes category, message, version, and OS', () => {
      const { service, driver } = makeService(Date.now, {
        appVersion: '1.4.0',
        platform: 'darwin',
      });
      const created = service.submit({ category: 'feature', message: 'Add dark mode please' });

      const email = service.buildShareEmail(created.id, { workspaceName: null });
      expect(email?.subject).toBe('Fixora Suggestion - Feature request');
      expect(email?.body).toContain('Category: Feature request');
      expect(email?.body).toContain('Add dark mode please');
      expect(email?.body).toContain('Fixora version: 1.4.0');
      expect(email?.body).toContain('Operating System: macOS');
      driver.close();
    });

    it('returns null for a suggestion id that does not exist (never crashes)', () => {
      const { service, driver } = makeService();
      expect(service.buildShareEmail('does-not-exist', { workspaceName: null })).toBeNull();
      driver.close();
    });

    it('returns null after the suggestion has been removed', () => {
      const { service, driver } = makeService();
      const created = service.submit({ category: 'bug', message: 'It crashed on save' });
      service.remove(created.id);
      expect(service.buildShareEmail(created.id, { workspaceName: null })).toBeNull();
      driver.close();
    });

    it('includes the workspace name when one is provided, and "Workspace: None" when not', () => {
      const { service, driver } = makeService();
      const created = service.submit({ category: 'feature', message: 'Workspace-aware email' });

      const withWorkspace = service.buildShareEmail(created.id, { workspaceName: 'my-project' });
      expect(withWorkspace?.body).toContain('Workspace: my-project');

      const withoutWorkspace = service.buildShareEmail(created.id, { workspaceName: null });
      expect(withoutWorkspace?.body).toContain('Workspace: None');
      driver.close();
    });

    it('includes a Timestamp line in the body', () => {
      const { service, driver } = makeService();
      const created = service.submit({ category: 'feature', message: 'Timestamped email' });
      const email = service.buildShareEmail(created.id, { workspaceName: null });
      expect(email?.body).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T/);
      driver.close();
    });
  });
});
