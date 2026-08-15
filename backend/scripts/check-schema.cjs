const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/starfit' });

  try {
    const result = await pool.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'checkpoint_blobs'
      ORDER BY ordinal_position
    `);

    console.log('[checkpoint_blobs] Current schema:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'NULL'})`);
    });

    // Check primary key
    const pkResult = await pool.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'checkpoint_blobs'::regclass
        AND i.indisprimary
    `);
    const pkColumns = pkResult.rows.map(r => r.attname);
    console.log('\n[checkpoint_blobs] Primary key:', pkColumns.join(', '));

    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
