// Simple script to check exercises table
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/starfit'
});

async function checkExercises() {
  try {
    console.log('Checking exercises table...');

    const countResult = await pool.query('SELECT COUNT(*) as count FROM exercises');
    console.log('Total exercises:', countResult.rows[0].count);

    if (parseInt(countResult.rows[0].count) > 0) {
      const sampleResult = await pool.query('SELECT id, name, exercise_type, difficulty FROM exercises LIMIT 10');
      console.log('\nSample exercises:');
      console.table(sampleResult.rows);
    } else {
      console.log('No exercises found. Need to seed the database.');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

checkExercises();
