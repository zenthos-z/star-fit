import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkVectorSearch() {
  console.log('========================================');
  console.log('向量搜索状态检查');
  console.log('========================================\n');

  try {
    // 检查 embedding 列
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(embedding) as with_embedding,
        COUNT(*) - COUNT(embedding) as without_embedding
      FROM exercises
    `);

    const stats = result.rows[0];
    console.log('动作统计:');
    console.log(`  总数: ${stats.total}`);
    console.log(`  有 embedding: ${stats.with_embedding}`);
    console.log(`  无 embedding: ${stats.without_embedding}`);

    // 检查 embedding 列的数据类型
    const typeInfo = await pool.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'exercises' AND column_name = 'embedding'
    `);

    if (typeInfo.rows.length > 0) {
      console.log('\nEmbedding 列数据类型:');
      console.log(`  data_type: ${typeInfo.rows[0].data_type}`);
      console.log(`  udt_name: ${typeInfo.rows[0].udt_name}`);
    }

    // 检查是否有 HNSW 索引
    const indexInfo = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'exercises' AND indexdef LIKE '%embedding%'
    `);

    console.log('\nEmbedding 索引:');
    if (indexInfo.rows.length === 0) {
      console.log('  ⚠️  没有找到 embedding 相关的索引');
    } else {
      for (const row of indexInfo.rows) {
        console.log(`  ${row.indexname}`);
        console.log(`    ${row.indexdef}`);
      }
    }

    // 检查几个示例 embedding
    if (stats.with_embedding > 0) {
      const samples = await pool.query(`
        SELECT id, name
        FROM exercises
        WHERE embedding IS NOT NULL
        LIMIT 5
      `);

      console.log('\n有 Embedding 的动作示例:');
      for (const row of samples.rows) {
        console.log(`  - ${row.name} (${row.id})`);
      }
    }

    // 检查是否有无 embedding 的动作
    if (stats.without_embedding > 0) {
      const missing = await pool.query(`
        SELECT id, name
        FROM exercises
        WHERE embedding IS NULL
        LIMIT 5
      `);

      console.log('\n缺少 Embedding 的动作:');
      for (const row of missing.rows) {
        console.log(`  - ${row.name} (${row.id})`);
      }
    }

    console.log('\n========================================');

  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await pool.end();
  }
}

checkVectorSearch();
