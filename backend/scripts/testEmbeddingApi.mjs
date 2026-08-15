import 'dotenv/config';

const API_ENDPOINT = process.env.OPENAI_BASE_URL + '/embeddings';
const API_KEY = process.env.OPENAI_API_KEY;

async function testEmbeddingApi() {
  console.log('========================================');
  console.log('测试 Embedding API 连接');
  console.log('========================================\n');

  console.log('API 配置:');
  console.log(`  端点: ${API_ENDPOINT}`);
  console.log(`  密钥: ${API_KEY ? API_KEY.substring(0, 10) + '...' : 'undefined'}`);

  const testText = '测试文本';

  console.log(`\n测试文本: "${testText}"`);
  console.log('\n发送请求...\n');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: testText
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`响应状态: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const error = await response.text();
      console.log(`错误响应: ${error}`);
      return;
    }

    const data = await response.json();
    console.log('\n成功! 返回数据:');
    console.log(`  模型: ${data.model}`);
    console.log(`  Embedding 维度: ${data.data[0].embedding.length}`);
    console.log(`  Token 用量: ${JSON.stringify(data.usage)}`);

    console.log('\n========================================');
    console.log('✅ API 连接正常');
    console.log('========================================');

  } catch (error) {
    console.log('\n========================================');
    console.log('❌ API 连接失败');
    console.log('========================================');
    console.log(`错误: ${error.message}`);
    console.log(`错误名称: ${error.name}`);
    console.log(`错误类型: ${error.constructor.name}`);

    if (error.name === 'AbortError') {
      console.log('\n原因: 请求超时 (10秒)');
    } else if (error.message.includes('ECONNRESET')) {
      console.log('\n原因: 连接被服务器重置');
      console.log('  - API 服务器可能过载');
      console.log('  - 网络连接可能不稳定');
      console.log('  - API 可能有并发限制');
    } else if (error.message.includes('ENOTFOUND')) {
      console.log('\n原因: 无法解析 API 服务器地址');
      console.log('  - 检查网络连接');
      console.log('  - 检查 DNS 设置');
    }
  }
}

testEmbeddingApi();
