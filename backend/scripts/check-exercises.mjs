import { getPostgresClient } from '../src/db/postgresql/client/postgres-client.ts';

const client = getPostgresClient();

console.log('Checking exercises table...');

client.query('SELECT COUNT(*) as count FROM exercises')
  .then(r => {
    console.log('Total exercises:', r.rows[0].count);
    return client.query('SELECT id, name, exercise_type, difficulty FROM exercises LIMIT 10');
  })
  .then(r => {
    console.log('Sample exercises:');
    console.table(r.rows);
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
