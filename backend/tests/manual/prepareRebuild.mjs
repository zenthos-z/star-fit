import 'dotenv/config';
import { Pool } from 'pg';

async function rebuildEmbeddings() {
  console.log('开始重建 embedding...');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 获取所有动作数据
    const { rows } = await pool.query(`
      SELECT id, name, attributes, content_html
      FROM exercises
      ORDER BY name
    `);

    console.log(`找到 ${rows.length} 个动作\n`);

    // 删除所有现有 embedding
    await pool.query('UPDATE exercises SET embedding = NULL');
    console.log('已清空所有 embedding\n');

    // 输出需要手动调用 API 的动作列表
    console.log('现在需要通过 API 为每个动作生成 embedding:');
    console.log('========================================');

    for (const row of rows) {
      const contentLen = row.content_html ? row.content_html.length : 0;
      console.log(`- ${row.name} (${row.id})`);
      console.log(`  教程: ${contentLen} 字符`);
    }

    console.log('========================================');
    console.log('\n提示: 请通过前端或 API 调用 VectorSearchService.indexExercise()');
    console.log('为每个动作传递 contentHtml 参数');

  } finally {
    await pool.end();
  }
}

rebuildEmbeddings();
