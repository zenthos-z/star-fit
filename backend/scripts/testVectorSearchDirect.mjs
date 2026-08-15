import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function testVectorSearch() {
  console.log('========================================');
  console.log('向量搜索效果测试');
  console.log('========================================\n');

  const testQueries = [
    { query: '练胸', description: '胸部训练' },
    { query: '需要哑铃', description: '哑铃器械' },
    { query: '练背', description: '背部训练' },
    { query: '垂直拉', description: '垂直拉动作模式' },
    { query: '不需要器械', description: '徒手训练' }
  ];

  try {
    // 首先，获取所有动作列表
    const allExercises = await pool.query(`
      SELECT id, name, attributes
      FROM exercises
      ORDER BY name
    `);

    console.log(`数据库中共有 ${allExercises.rows.length} 个动作\n`);

    // 对每个查询进行测试
    for (const { query, description } of testQueries) {
      console.log(`\n查询: "${query}" (${description})`);
      console.log('─'.repeat(50));

      // 直接查询数据库获取动作列表（不使用向量搜索）
      // 这是为了看看有哪些动作可能匹配
      console.log('\n所有动作列表:');
      for (const row of allExercises.rows) {
        console.log(`  - ${row.name} (${row.id})`);
      }

      // 使用 pgvector 的余弦相似度搜索
      // 注意：这里我们只是模拟，因为没有实际的 embedding API 调用
      console.log('\n⚠️  需要通过 Embedding API 生成查询向量才能进行实际搜索');
    }

    console.log('\n========================================');
    console.log('\n分析建议:');
    console.log('1. 动作数量较少（仅12个）可能影响搜索效果');
    console.log('2. 需要检查 embedding 内容的质量');
    console.log('3. 建议查看 VectorSearchService.buildEmbeddingText 方法');
    console.log('========================================');

  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await pool.end();
  }
}

testVectorSearch();
