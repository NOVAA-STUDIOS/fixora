import type { Row, SqliteDriver } from '../db/driver.js';

/**
 * The storage layer: the only code that writes SQL against the `suggestions` table. It moves rows,
 * not domain objects — column names in, `Row` shapes out. The repository above it is what turns
 * these into a `Suggestion`; storage does not know that type exists, the same separation `db/driver.ts`
 * draws between a driver and the repositories built on it, one level further down.
 */

export type NewSuggestionRow = {
  id: string;
  category: string;
  message: string;
  createdAt: number;
};

export function createSuggestionStorage(driver: SqliteDriver) {
  return {
    insert(row: NewSuggestionRow): void {
      driver
        .prepare(
          `INSERT INTO suggestions (id, category, message, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(row.id, row.category, row.message, row.createdAt);
    },

    selectAll(limit: number): Row[] {
      return driver
        .prepare('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT ?')
        .all(limit);
    },

    selectById(id: string): Row | undefined {
      return driver.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
    },

    deleteById(id: string): void {
      driver.prepare('DELETE FROM suggestions WHERE id = ?').run(id);
    },

    deleteAll(): void {
      driver.prepare('DELETE FROM suggestions').run();
    },
  };
}

export type SuggestionStorage = ReturnType<typeof createSuggestionStorage>;
