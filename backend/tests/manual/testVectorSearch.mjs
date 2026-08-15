/**
 * 测试向量搜索效果
 */

import 'dotenv/config';
import { Pool } from 'pg';

const EMBEDDING_API = 'https://www.dmxapi.cn/v1/embeddings';
const API_KEY = process.env.OPENAI_API_KEY;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 生成查询 embedding
async function generateQueryEmbedding(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(EMBEDDING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 1536
    }),
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// 执行向量搜索
async function vectorSearch(queryEmbedding, limit = 5, threshold = 0.4) {
  const distanceThreshold = 1 - threshold;
  const embeddingArray = `[${queryEmbedding.join(',')}]`;

  const result = await pool.query(
    `SELECT
      id,
      name,
      1 - (embedding <=> $1::vector) as similarity
    FROM exercises
    WHERE embedding IS NOT NULL
      AND (embedding <=> $1::vector) < $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3`,
    [embeddingArray, distanceThreshold, limit]
  );

  return result.rows;
}

// 测试查询
const testQueries = [
  '练胸',
  '练背',
  '需要哑铃',
  '不需要器械',
  '垂直拉',
  '对肩部友好'
];

console.log('========================================');
console.log('向量搜索测试');
console.log('========================================\n');

for (const query of testQueries) {
  console.log(`查询: "${query}"`);
  console.log('─'.repeat(50));

  try {
    const queryEmbedding = await generateQueryEmbedding(query);
    const results = await vectorSearch(queryEmbedding);

    if (results.length === 0) {
      console.log('  ⚠️  未找到结果\n');
    } else {
      results.forEach((row, i) => {
        console.log(`  ${i + 1}. ${row.name} (${row.id})`);
        console.log(`     相似度: ${(row.similarity * 100).toFixed(0)}%`);
      });
      console.log('');
    }

    // 避免过快请求
    await new Promise(r => setTimeout(r, 500));

  } catch (error) {
    console.log(`  ✗ 错误: ${error.message}\n`);
  }
}

console.log('========================================');
console.log('测试完成');
console.log('========================================');

await pool.end();
