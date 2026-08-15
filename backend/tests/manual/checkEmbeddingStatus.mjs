import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const result = await pool.query(`
  SELECT
    id,
    name,
    CASE
      WHEN embedding IS NULL THEN 'NULL'
      ELSE 'EXISTS'
    END as embedding_status,
    LENGTH(content_html) as tutorial_length
  FROM exercises
  ORDER BY name
`);

console.log('=== 动作 Embedding 状态 ===');
console.log('总计:', result.rows.length, '个动作\n');

let nullCount = 0;
let existsCount = 0;

result.rows.forEach(row => {
  if (row.embedding_status === 'NULL') nullCount++;
  else existsCount++;

  console.log(`${row.name} (${row.id})`);
  console.log(`  Embedding: ${row.embedding_status}`);
  console.log(`  教程长度: ${row.tutorial_length} 字符\n`);
});

console.log('=== 统计 ===');
console.log(`NULL: ${nullCount}`);
console.log(`EXISTS: ${existsCount}`);

await pool.end();
