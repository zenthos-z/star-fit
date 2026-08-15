/**
 * 测试向量搜索 API
 */

const https = require('https');

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://www.dmxapi.cn/v1';
const API_ENDPOINT = `${BASE_URL}/embeddings`;

console.log('=== 测试 Embedding API ===');
console.log(`API Endpoint: ${API_ENDPOINT}`);
console.log(`API Key: ${API_KEY ? '已设置' : '未设置'}`);

const testQueries = [
  '全身训练',
  '复合动作',
  '多肌群',
  '胸部训练',
  '深蹲'
];

async function testEmbedding(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536
    });

    const url = new URL(API_ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode === 200) {
            resolve(result);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  for (const query of testQueries) {
    console.log(`\n测试查询: "${query}"`);
    try {
      const result = await testEmbedding(query);
      console.log(`  ✅ 成功 - embedding 维度: ${result.data[0].embedding.length}`);
    } catch (error) {
      console.log(`  ❌ 失败 - ${error.message}`);
    }
  }
  console.log('\n=== 测试完成 ===');
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
