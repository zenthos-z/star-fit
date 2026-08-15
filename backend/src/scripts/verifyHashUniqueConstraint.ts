/**
 * Verify hash UNIQUE constraint migration
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

import { getPostgresClient } from '../db/postgresql/index.js';

async function verifyMigration() {
  const client = getPostgresClient();

  console.log('=== 验证迁移 005_add_user_media_hash_unique ===\n');

  // Check constraint
  const constraints = await client.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_media'
      AND constraint_type = 'UNIQUE'
  `);

  console.log('UNIQUE 约束:');
  if (constraints.rows.length === 0) {
    console.log('  ⚠️  未找到 UNIQUE 约束');
  } else {
    constraints.rows.forEach(c => console.log('  ✓', c.constraint_name));
  }

  // Check indexes
  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'user_media'
  `);

  console.log('\n索引:');
  indexes.rows.forEach(i => console.log('  -', i.indexname));

  // Check table structure
  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_media'
    ORDER BY ordinal_position
  `);

  console.log('\n表结构:');
  columns.rows.forEach(c => {
    console.log(`  - ${c.column_name}: ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ` DEFAULT ${c.column_default}` : ''}`);
  });

  process.exit(0);
}

verifyMigration().catch(console.error);
