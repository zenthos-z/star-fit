import 'dotenv/config';

const API_ENDPOINT = process.env.OPENAI_BASE_URL + '/embeddings';
const API_KEY = process.env.OPENAI_API_KEY;

async function testConcurrentRequests() {
  console.log('========================================');
  console.log('测试并发 Embedding 请求');
  console.log('========================================\n');

  const queries = [
    '高位下拉',
    '练胸',
    '需要哑铃',
    '垂直拉',
    '不需要器械'
  ];

  console.log(`测试 ${queries.length} 个并发请求...\n`);

  try {
    const promises = queries.map(async (query, index) => {
      const startTime = Date.now();
      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: query
          })
        });

        const duration = Date.now() - startTime;

        if (response.ok) {
          const data = await response.json();
          return {
            query,
            success: true,
            duration,
            status: response.status
          };
        } else {
          return {
            query,
            success: false,
            duration,
            status: response.status,
            error: `HTTP ${response.status}`
          };
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        return {
          query,
          success: false,
          duration,
          error: error.message
        };
      }
    });

    const results = await Promise.all(promises);

    console.log('结果:');
    console.log('─'.repeat(60));
    for (const result of results) {
      if (result.success) {
        console.log(`✅ "${result.query}" - ${result.duration}ms (HTTP ${result.status})`);
      } else {
        console.log(`❌ "${result.query}" - ${result.error}`);
      }
    }

    console.log('\n========================================');

  } catch (error) {
    console.error('测试失败:', error);
  }
}

testConcurrentRequests();
