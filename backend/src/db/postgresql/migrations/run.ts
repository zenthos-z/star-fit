/**
 * Database Migration Runner Script
 *
 * Usage:
 *   npm run db:migrate          # Run all pending migrations
 *   npm run db:migrate:dry      # Dry run (show what would be applied)
 *   npm run db:migrate:status   # Show migration status
 *
 * @version 1.0.0
 * @created 2026-02-09
 */

import { runMigrations, showMigrationStatus } from './migrationRunner.js';

const args = process.argv.slice(2);
const command = args[0] || 'migrate';

async function main() {
  try {
    switch (command) {
      case 'migrate':
        console.log('[Migration] Starting...\n');
        const results = await runMigrations();
        const failed = results.filter(r => !r.success).length;
        if (failed > 0) {
          process.exit(1);
        }
        break;

      case 'dry':
        console.log('[Migration] Dry run mode...\n');
        await runMigrations({ dryRun: true });
        break;

      case 'status':
        await showMigrationStatus();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Available commands: migrate, dry, status');
        process.exit(1);
    }
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
    process.exit(1);
  }
}

main();
