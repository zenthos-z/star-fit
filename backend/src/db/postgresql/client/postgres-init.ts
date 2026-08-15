/**
 * PostgreSQL Database Initialization Script
 *
 * Usage:
 *   node dist/db/postgres-init.js              # Initialize database
 *   node dist/db/postgres-init.js --drop       # Drop and recreate
 *   node dist/db/postgres-init.js --seed       # Seed with test data
 *
 * @version 3.0.0
 */

import fs from 'fs';
import path from 'path';
import { PostgresClient } from './postgres-client.js';
import { createLogger } from '../../../utils/logger.js';
import { getPostgresConfig, resetConfigCache } from '../config.js';

// Handle Jest environment which provides __filename and __dirname
// Jest transforms ESM but doesn't provide import.meta.url
// Also handle when both are undefined (ESM runtime)
declare const __filename: string | undefined;
declare const __dirname: string | undefined;

// Safe function to get current file path
const getCurrentFilePath = (): string => {
  if (typeof __filename !== 'undefined' && __filename !== '') {
    return __filename;
  }
  // Try to use import.meta.url if available (ESM runtime)
  try {
    // @ts-ignore - import.meta may not exist in Jest transform
    const _importMeta = globalThis as { meta?: { url?: string } };
    if (_importMeta.meta?.url) {
      const { fileURLToPath } = require('url');
      return fileURLToPath(_importMeta.meta.url);
    }
  } catch {
    // Fall through to default
  }
  // Fallback for tests
  return '/mock/postgres-init.ts';
};

const _filename = getCurrentFilePath();
const _dirname = typeof __dirname !== 'undefined' && __dirname !== ''
  ? __dirname
  : path.dirname(_filename);

// Get the correct schema path regardless of runtime environment
const getSchemaPath = (): string => {
  // First try relative to current file (ESM runtime with tsx)
  const relativePath = path.join(_dirname, '..', 'schema', 'schema.sql');
  if (fs.existsSync(relativePath)) {
    return relativePath;
  }

  // Fallback: try path relative to project root
  // __dirname might be /mock in some environments, so try project-relative path
  const projectRootPath = path.join(process.cwd(), 'src', 'db', 'postgresql', 'schema', 'schema.sql');
  if (fs.existsSync(projectRootPath)) {
    return projectRootPath;
  }

  // Last fallback: try the alternative schema location
  const altPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
  if (fs.existsSync(altPath)) {
    return altPath;
  }

  // Return the original path for error reporting
  return relativePath;
};

interface InitOptions {
  drop?: boolean;
  seed?: boolean;
  preset?: 'development' | 'test' | 'production';
}

async function initializeDatabase(options: InitOptions = {}): Promise<void> {
  const logger = createLogger({ component: 'PostgresInit' });
  const { drop = false, seed = false, preset } = options;

  // Reset config cache to apply preset
  if (preset) {
    resetConfigCache();
  }

  logger.info('Starting PostgreSQL initialization', { drop, seed, preset });

  const client = new PostgresClient({ preset });

  try {
    // Test connection
    await client.connect();
    logger.info('Connected to PostgreSQL');

    // Check if database is already initialized (unless drop is requested)
    if (!drop) {
      const existingTables = await client.query(`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' LIMIT 1
      `);

      if (existingTables.rows.length > 0) {
        logger.info('Database already initialized, skipping schema creation');
        return;
      }
    }

    // Drop database if requested
    if (drop) {
      logger.warn('Dropping all tables...');
      await dropAllTables(client);
    }

    // Read and execute schema
    const schemaPath = getSchemaPath();
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

    logger.info('Executing schema...');
    await client.query(schemaSql);
    logger.info('Schema created successfully');

    // Verify tables
    const tables = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    logger.info(`Created ${tables.rows.length} tables:`, {
      tables: tables.rows.map((r) => r.tablename),
    });

    // Verify extensions
    const extensions = await client.query(`
      SELECT extname
      FROM pg_extension
      WHERE extname IN ('uuid-ossp', 'vector')
      ORDER BY extname
    `);

    logger.info('Extensions verified:', {
      extensions: extensions.rows.map((r) => r.extname),
    });

    // Verify indexes
    const indexes = await client.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);

    logger.info(`Created ${indexes.rows.length} indexes`);

    // Verify materialized views
    const views = await client.query(`
      SELECT matviewname
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname
    `);

    logger.info(`Created ${views.rows.length} materialized views:`, {
      views: views.rows.map((r) => r.matviewname),
    });

    // Seed data if requested
    if (seed) {
      logger.info('Seeding database with test data...');
      await seedDatabase(client);
    }

    logger.info('PostgreSQL initialization completed successfully');
  } catch (error) {
    logger.error('Initialization failed', error as Error);
    throw error;
  } finally {
    await client.close();
  }
}

// Export for use as a module
export { initializeDatabase };

async function dropAllTables(client: PostgresClient): Promise<void> {
  // Drop materialized views first
  await client.query(`
    DO $$
    BEGIN
      DROP MATERIALIZED VIEW IF EXISTS user_current_state CASCADE;
      DROP MATERIALIZED VIEW IF EXISTS exercise_summary CASCADE;
    END $$;
  `);

  // Drop all tables
  const tables = [
    'import_batches',
    'video_tasks',
    'audit_logs',
    'cache_rpe_stats',
    'cache_history_summaries',
    'deviation_logs',
    'user_media',
    'prompt_style_configs',
    'app_configs',
    'guidance',
    'rpe_logs',
    'sessions',
    'exercises',
    'users',
  ];

  for (const table of tables) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }

  // Drop types
  await client.query(`
    DO $$
    BEGIN
      DROP TYPE IF EXISTS import_batch_status CASCADE;
      DROP TYPE IF EXISTS video_task_status CASCADE;
      DROP TYPE IF EXISTS session_status CASCADE;
      DROP TYPE IF EXISTS modified_by_type CASCADE;
      DROP TYPE IF EXISTS user_role CASCADE;
      DROP TYPE IF EXISTS difficulty_level CASCADE;
      DROP TYPE IF EXISTS exercise_type_enum CASCADE;
    END $$;
  `);
}

async function seedDatabase(client: PostgresClient): Promise<void> {
  // Create a test user
  const testUser = await client.query(`
    INSERT INTO users (id, device_id, profile_static, profile_dynamic, history_summary)
    VALUES (
      uuid_generate_v4(),
      'test-device-001',
      '{
        "age": 30,
        "weight": 75,
        "height": 180,
        "neurotype": "type_2a",
        "risk_preference": "moderate"
      }'::jsonb,
      '{
        "load_anchors": {},
        "active_limitations": [],
        "recovery_state": {
          "total_score": 85,
          "cns_fusing": false
        }
      }'::jsonb,
      '{
        "last_pattern": null,
        "trends": {
          "rpe_trend": "stable",
          "volume_trend": "stable"
        },
        "recent_summary": "New user"
      }'::jsonb
    )
    RETURNING id
  `);

  console.log(`Created test user: ${testUser.rows[0].id}`);

  // Create test exercises
  const exercises = [
    {
      id: 'bench_press',
      name: '杠铃卧推',
      exercise_type: 'resistance',
      difficulty: 'intermediate',
      attributes: {
        targets: { primary: ['胸大肌'], secondary: ['三角肌前束', '肱三头肌'] },
        equipment_required: ['barbell', 'bench'],
        impact_level: { shoulder: 6, chest: 9, triceps: 7 },
        pattern: 'push',
        movement_plane: 'sagittal',
      },
    },
    {
      id: 'squat',
      name: '深蹲',
      exercise_type: 'resistance',
      difficulty: 'intermediate',
      attributes: {
        targets: { primary: ['股四头肌'], secondary: ['臀大肌', '竖脊肌'] },
        equipment_required: ['barbell'],
        impact_level: { knee: 10, back: 8, hips: 9 },
        pattern: 'squat',
        movement_plane: 'sagittal',
      },
    },
  ];

  for (const exercise of exercises) {
    await client.query(
      `
      INSERT INTO exercises (id, name, exercise_type, difficulty, attributes)
      VALUES ($1, $2, $3::exercise_type_enum, $4::difficulty_level, $5::jsonb)
    `,
      [exercise.id, exercise.name, exercise.exercise_type, exercise.difficulty, exercise.attributes]
    );
  }

  console.log(`Created ${exercises.length} test exercises`);
}

// CLI execution - check if running as main module
// Compatible with both ESM and Jest environments
const isMainModule = typeof require === 'undefined'
  ? (() => {
      try {
        const _importMeta = globalThis as { meta?: { url?: string } };
        return _importMeta.meta?.url === `file://${process.argv[1]}`;
      } catch {
        return false;
      }
    })()
  : process.argv[1]?.endsWith(_filename.replace(/\.ts$/, '.js'));

if (isMainModule) {
  const args = process.argv.slice(2);
  const options: InitOptions = {
    drop: args.includes('--drop'),
    seed: args.includes('--seed'),
    preset: (args.find((a) => a.startsWith('--preset='))?.split('=')[1] as any) || undefined,
  };

  initializeDatabase(options)
    .then(() => {
      console.log('Database initialization complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}
