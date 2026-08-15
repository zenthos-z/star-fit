import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkMultipleSources() {
  console.log('========================================');
  console.log('检查多套动作数据');
  console.log('========================================\n');

  try {
    // 1. 检查所有与 exercise 相关的表
    console.log('1. 查找所有 exercise 相关的表:');
    console.log('─'.repeat(50));
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE '%exercise%'
      ORDER BY table_name
    `);

    for (const row of tables.rows) {
      console.log(`  - ${row.table_name}`);
    }

    // 2. 检查每个表的数据量
    console.log('\n2. 各表的记录数:');
    console.log('─'.repeat(50));
    for (const row of tables.rows) {
      const count = await pool.query(`SELECT COUNT(*) as count FROM ${row.table_name}`);
      console.log(`  ${row.table_name}: ${count.rows[0].count} 条记录`);
    }

    // 3. 检查主 exercises 表的详情
    console.log('\n3. exercises 表详细分析:');
    console.log('─'.repeat(50));

    const total = await pool.query(`SELECT COUNT(*) as count FROM exercises`);
    const withHtml = await pool.query(`SELECT COUNT(*) as count FROM exercises WHERE content_html IS NOT NULL AND content_html != ''`);
    const withEmbedding = await pool.query(`SELECT COUNT(*) as count FROM exercises WHERE embedding IS NOT NULL`);

    console.log(`  总记录数: ${total.rows[0].count}`);
    console.log(`  有教程内容 (content_html): ${withHtml.rows[0].count}`);
    console.log(`  有 embedding: ${withEmbedding.rows[0].count}`);

    // 4. 检查是否有教程内容的动作
    console.log('\n4. 有教程内容的动作:');
    console.log('─'.repeat(50));
    const withContent = await pool.query(`
      SELECT id, name, LENGTH(content_html) as content_length
      FROM exercises
      WHERE content_html IS NOT NULL AND content_html != ''
      ORDER BY name
    `);

    if (withContent.rows.length === 0) {
      console.log('  ⚠️  没有找到有教程内容的动作');
    } else {
      for (const row of withContent.rows) {
        console.log(`  - ${row.name} (${row.id}): ${row.content_length} 字符`);
      }
    }

    // 5. 检查所有动作（包括没有教程的）
    console.log('\n5. 所有动作列表:');
    console.log('─'.repeat(50));
    const allExercises = await pool.query(`
      SELECT id, name,
        CASE WHEN content_html IS NULL OR content_html = '' THEN '无' ELSE '有' END as has_tutorial,
        CASE WHEN embedding IS NULL THEN '无' ELSE '有' END as has_embedding
      FROM exercises
      ORDER BY name
    `);

    for (const row of allExercises.rows) {
      console.log(`  ${row.name} (${row.id}) - 教程:[${row.has_tutorial}] Embedding:[${row.has_embedding}]`);
    }

    // 6. 检查环境变量中的数据库配置
    console.log('\n6. 数据库配置:');
    console.log('─'.repeat(50));
    const dbName = process.env.DATABASE_URL?.split('/').pop()?.split('?')[0];
    console.log(`  当前数据库: ${dbName}`);

    console.log('\n========================================');

  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await pool.end();
  }
}

checkMultipleSources();
