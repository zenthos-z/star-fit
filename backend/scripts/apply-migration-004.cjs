/**
 * Apply Migration 004 - Restore created_at to user_insights view
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function applyMigration() {
  // Read DATABASE_URL from .env
  const dotenv = require('dotenv');
  const envPath = path.join(__dirname, '../.env');
  dotenv.config({ path: envPath });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not found in environment');
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    // Ensure migration_metadata table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_metadata (
        version VARCHAR(20) PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Reading migration file...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '../src/db/postgresql/migrations/004_add_id_to_view.sql'),
      'utf8'
    );

    console.log('Applying migration 004...');
    await client.query(migrationSQL);
    console.log('✓ Migration 004 applied successfully');

    // Verify the view has created_at
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'user_insights'
      ORDER BY ordinal_position
    `);

    console.log('\nView columns after migration:');
    result.rows.forEach(row => console.log(`  - ${row.column_name}: ${row.data_type}`));

    // Check specifically for created_at
    const hasCreatedAt = result.rows.some(row => row.column_name === 'created_at');
    const hasUpdatedAt = result.rows.some(row => row.column_name === 'updated_at');

    console.log('\nVerification:');
    console.log(`  created_at present: ${hasCreatedAt ? '✓' : '✗'}`);
    console.log(`  updated_at present: ${hasUpdatedAt ? '✓' : '✗'}`);

  } catch (err) {
    console.error('Error:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

applyMigration().then(() => {
  console.log('\nDone!');
  process.exit(0);
}).catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
