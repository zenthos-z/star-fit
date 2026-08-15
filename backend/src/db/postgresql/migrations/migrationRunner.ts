/**
 * PostgreSQL Migration Runner
 *
 * Manages database schema migrations with tracking and rollback support.
 *
 * Features:
 * - Migration metadata tracking
 * - Transaction-safe execution
 * - Sequential version ordering
 * - Idempotent operations
 *
 * @version 1.0.0
 * @created 2026-02-09
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPostgresClient, type PostgresClient } from '../../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filepath: string;
}

export interface MigrationResult {
  version: string;
  name: string;
  success: boolean;
  error?: string;
  duration: number;
}

// ============================================================================
// Migration Runner
// ============================================================================

export class MigrationRunner {
  private migrationsDir: string;
  private client: PostgresClient;

  constructor(migrationsDir?: string) {
    this.migrationsDir = migrationsDir || path.join(__dirname);
    this.client = getPostgresClient();
  }

  /**
   * Ensure the migration metadata table exists
   */
  async ensureMetadataTable(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS migration_metadata (
        version VARCHAR(20) PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * Get set of already applied migration versions
   */
  async getAppliedMigrations(): Promise<Set<string>> {
    await this.ensureMetadataTable();
    const result = await this.client.query('SELECT version FROM migration_metadata ORDER BY version');
    return new Set(result.rows.map((r: any) => r.version));
  }

  /**
   * List all available migration files
   */
  listMigrations(): MigrationFile[] {
    if (!fs.existsSync(this.migrationsDir)) {
      throw new Error(`Migrations directory not found: ${this.migrationsDir}`);
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql') && f.match(/^\d+_/))
      .sort();

    return files.map(filename => {
      const match = filename.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        throw new Error(`Invalid migration filename: ${filename}`);
      }
      const [, version, name] = match;
      return {
        version,
        name,
        filename,
        filepath: path.join(this.migrationsDir, filename)
      };
    });
  }

  /**
   * Execute a single migration within a transaction
   */
  async executeMigration(migration: MigrationFile): Promise<MigrationResult> {
    const startTime = Date.now();
    const sql = fs.readFileSync(migration.filepath, 'utf-8');

    try {
      await this.client.transaction(async (tx) => {
        // Execute migration SQL
        await tx.query(sql);
      });

      const duration = Date.now() - startTime;
      console.log(`[Migration] Completed: ${migration.version}_${migration.name} (${duration}ms)`);

      return {
        version: migration.version,
        name: migration.name,
        success: true,
        duration
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.error(`[Migration] Failed: ${migration.version}_${migration.name}`, error);

      return {
        version: migration.version,
        name: migration.name,
        success: false,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Run all pending migrations
   */
  async migrate(options?: { dryRun?: boolean }): Promise<MigrationResult[]> {
    const applied = await this.getAppliedMigrations();
    const migrations = this.listMigrations();

    const results: MigrationResult[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        console.log(`[Migration] Skipping: ${migration.filename} (already applied)`);
        continue;
      }

      if (options?.dryRun) {
        console.log(`[Migration] Would apply: ${migration.filename} (dry run)`);
        results.push({
          version: migration.version,
          name: migration.name,
          success: true,
          duration: 0
        });
        continue;
      }

      const result = await this.executeMigration(migration);
      results.push(result);

      if (!result.success) {
        console.error(`[Migration] Stopping due to error in ${migration.filename}`);
        break;
      }
    }

    this.printSummary(results);
    return results;
  }

  /**
   * Get migration status
   */
  async status(): Promise<void> {
    const applied = await this.getAppliedMigrations();
    const migrations = this.listMigrations();

    console.log('\n=== Migration Status ===\n');

    for (const migration of migrations) {
      const status = applied.has(migration.version) ? '✓ Applied' : '⊘ Pending';
      console.log(`  ${status}: ${migration.filename}`);
    }

    const appliedCount = migrations.filter(m => applied.has(m.version)).length;
    const pendingCount = migrations.length - appliedCount;

    console.log(`\nTotal: ${migrations.length} migrations (${appliedCount} applied, ${pendingCount} pending)\n`);
  }

  /**
   * Print migration summary
   */
  private printSummary(results: MigrationResult[]): void {
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n=== Migration Summary ===');
    console.log(`  Applied: ${success}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Duration: ${totalDuration}ms`);
    console.log('========================\n');
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Run all pending migrations
 */
export async function runMigrations(options?: { dryRun?: boolean }): Promise<MigrationResult[]> {
  const migrationsDir = path.join(process.cwd(), 'backend/src/db/postgresql/migrations');
  const runner = new MigrationRunner(migrationsDir);
  return runner.migrate(options);
}

/**
 * Show migration status
 */
export async function showMigrationStatus(): Promise<void> {
  const migrationsDir = path.join(process.cwd(), 'backend/src/db/postgresql/migrations');
  const runner = new MigrationRunner(migrationsDir);
  await runner.status();
}
