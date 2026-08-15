import { Pool } from 'pg';

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'starfit',
  password: 'postgres',
  port: 5432
});

(async () => {
  try {
    // Check if profile_state_audit table exists
    const r = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%audit%'
    `);
    console.log('Audit tables:', r.rows.map(row => row.table_name));

    // Check all tables
    const allTables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('All tables (first 20):', allTables.rows.slice(0, 20).map(row => row.table_name));

    // Check users table structure
    const usersInfo = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    console.log('Users table columns:', usersInfo.rows.map(row => `${row.column_name}: ${row.data_type}`));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
