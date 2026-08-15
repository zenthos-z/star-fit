/**
 * Rebuild Database Script
 *
 * Drops and recreates the database, then applies the schema.
 * WARNING: This will delete all data!
 *
 * Usage: npx tsx scripts/rebuild-database.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit';
const DB_NAME = 'starfit';

async function main() {
  console.log('⚠️  WARNING: This will DELETE ALL DATA in the database!\n');

  // Parse connection info
  const url = new URL(DATABASE_URL);
  const host = url.hostname;
  const port = parseInt(url.port || '5432');
  const user = url.username;
  const password = url.password;

  // Connect to 'postgres' database (default, always exists)
  const adminPool = new Pool({
    host,
    port,
    user,
    password,
    database: 'postgres',
  });

  try {
    // 1. Terminate existing connections
    console.log('📡 Terminating existing connections...');
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [DB_NAME]);

    // 2. Drop database
    console.log('🗑️  Dropping database...');
    await adminPool.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);

    // 3. Create database
    console.log('📦 Creating database...');
    await adminPool.query(`CREATE DATABASE ${DB_NAME}`);

    await adminPool.end();
    console.log('✅ Database recreated!\n');

    // 4. Connect to new database and apply schema
    const dbPool = new Pool({
      host,
      port,
      user,
      password,
      database: DB_NAME,
    });

    console.log('📋 Applying schema...');

    // Read schema file
    const schemaPath = path.join(__dirname, '../src/db/postgresql/schema/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema
    await dbPool.query(schema);

    await dbPool.end();
    console.log('✅ Schema applied successfully!\n');

    console.log('🎉 Database rebuild complete!');
    console.log('   Database:', DB_NAME);
    console.log('   New columns: username, short_id');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
