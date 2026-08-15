import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const result = await pool.query('SELECT id, name, exercise_type, difficulty FROM exercises LIMIT 10');
  console.log('Exercises:');
  result.rows.forEach(row => {
    console.log(`- ${row.id}: ${row.name} (${row.exercise_type}, ${row.difficulty})`);
  });

  const countResult = await pool.query('SELECT COUNT(*) as total FROM exercises');
  console.log(`\nTotal: ${countResult.rows[0].total}`);

  await pool.end();
  process.exit(0);
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
