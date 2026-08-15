/**
 * Run the fix-user-insights-view migration
 *
 * Usage: node scripts/run-migration.cjs
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  // Get database connection from environment
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ DATABASE_URL not set');
    console.error('Please set DATABASE_URL environment variable');
    process.exit(1);
  }

  console.log('🔗 Connecting to database...');

  const pool = new Pool({ connectionString });

  try {
    // Read migration file (path relative to backend folder)
    const migrationPath = path.join(__dirname, '..', 'src', 'db', 'postgresql', 'migrations', 'fix-user-insights-view.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('🚀 Executing migration...\n');

    // Execute migration
    await pool.query(sql);

    console.log('\n✅ Migration completed successfully!');

    // Verify the VIEW
    console.log('\n🔍 Verifying user_insights VIEW...');
    const result = await pool.query('SELECT user_id, fitness_level, red_flags FROM user_insights LIMIT 1');

    if (result.rows.length > 0) {
      console.log('✅ VIEW is working. Sample data:');
      console.log(JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log('✅ VIEW is working (no users in database yet)');
    }

    // Count users
    const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log(`\n📊 Total users in database: ${countResult.rows[0].count}`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
