import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT
    id,
    name,
    CASE
      WHEN embedding IS NULL THEN 'NULL'
      ELSE 'OK'
    END as embedding_status
  FROM exercises
  ORDER BY name
`)
  .then(res => {
    console.log('Embedding Status:');
    console.table(res.rows);

    // Count embeddings
    const total = res.rows.length;
    const withEmbedding = res.rows.filter(r => r.embedding_status.startsWith('OK')).length;
    console.log(`\nTotal: ${total}, With Embeddings: ${withEmbedding}`);

    pool.end();
  })
  .catch(err => {
    console.error(err);
    pool.end();
  });
