import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function main() {
  const result = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('username', 'short_id', 'id', 'device_id', 'created_at')
    ORDER BY ordinal_position
  `);

  console.log('\n📋 Users table - Key columns:');
  console.table(result.rows);

  // Check indexes
  const indexResult = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'users' AND indexname LIKE '%username%' OR indexname LIKE '%short_id%'
  `);

  console.log('\n🔍 User-friendly ID indexes:');
  console.table(indexResult.rows);

  await pool.end();
}

main();
