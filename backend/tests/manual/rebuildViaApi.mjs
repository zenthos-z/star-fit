import 'dotenv/config';

async function rebuildViaApi() {
  const BASE_URL = 'http://localhost:43111';

  // 首先获取所有动作
  console.log('获取动作列表...');

  const response = await fetch(`${BASE_URL}/api/exercises`);
  const exercises = await response.json();

  console.log(`找到 ${exercises.length} 个动作\n`);

  // 为每个动作触发重新索引（通过删除然后添加）
  for (const exercise of exercises) {
    console.log(`处理: ${exercise.name} (${exercise.id})`);

    try {
      // 调用 indexExercise API（需要管理员权限）
      const result = await fetch(`${BASE_URL}/api/admin/exercises/${exercise.id}/index`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          exerciseId: exercise.id,
          name: exercise.name,
          attributes: exercise.attributes,
          contentHtml: exercise.content_html,
          forceRegenerate: true
        })
      });

      if (result.ok) {
        console.log(`  ✓ 成功`);
      } else {
        console.log(`  ✗ 失败: ${result.status}`);
      }
    } catch (error) {
      console.log(`  ✗ 错误: ${error.message}`);
    }

    // 避免过快请求
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n重建完成!');
}

rebuildViaApi();
