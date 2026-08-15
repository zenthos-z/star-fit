const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  user: 'postgres',
  password: '',
  host: 'localhost',
  port: 5432,
  database: 'starfit',
});

client.connect((err) => {
  if (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }

  console.log('Checking users table structure...');

  client.query(`
    SELECT
      u.id,
      u.profile_static,
      u.profile_dynamic
    FROM users u
    LIMIT 1
  `, (err, res) => {
    if (err) {
      console.error('Query error:', err);
      process.exit(1);
    }

    const row = res.rows[0];
    console.log('profile_static type:', typeof row.profile_static);
    console.log('profile_dynamic type:', typeof row.profile_dynamic);

    client.end();
  });
});
