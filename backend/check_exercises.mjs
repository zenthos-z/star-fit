import { getPostgresClient } from './src/db/postgresql/index.js';

async function main() {
  const db = getPostgresClient();
  try {
    const result = await db.query('SELECT COUNT(*) as count FROM exercises');
    console.log('Exercises count:', result.rows[0].count);
    
    const samples = await db.query('SELECT id, name, exercise_type FROM exercises LIMIT 5');
    console.log('Sample exercises:', samples.rows);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main().then(() => process.exit(0));
