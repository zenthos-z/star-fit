#!/usr/bin/env tsx
import 'dotenv/config';
import { PostgresClient } from '../db/postgresql/client/postgres-client.js';

async function checkMissing() {
  const client = new PostgresClient({ preset: 'development' });

  try {
    await client.connect();

    const result = await client.query(`
      SELECT
        id,
        name,
        exercise_type,
        difficulty,
        content_html,
        CASE
          WHEN content_html IS NULL OR LENGTH(TRIM(content_html)) < 100 THEN true
          ELSE false
        END as needs_content
      FROM exercises
      ORDER BY
        needs_content DESC,
        name ASC
    `);

    console.log('所有动作列表（按需要内容排序）：');
    console.log('='.repeat(80));

    result.rows.forEach((row: any, index: number) => {
      console.log(`${index + 1}. ${row.name} (${row.id})`);
      console.log(`   类型: ${row.exercise_type}, 难度: ${row.difficulty}`);
      console.log(`   需要内容: ${row.needs_content ? '是' : '否'}`);
      console.log(`   内容长度: ${row.content_html ? row.content_html.length : 0}`);
      console.log('');
    });

    await client.close();
  } catch (error) {
    console.error('查询失败:', error);
    process.exit(1);
  }
}

checkMissing();
