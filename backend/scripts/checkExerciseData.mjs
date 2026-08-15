import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkExerciseData() {
  console.log('========================================');
  console.log('动作数据质量检查');
  console.log('========================================\n');

  try {
    const result = await pool.query(`
      SELECT id, name, attributes
      FROM exercises
      ORDER BY name
    `);

    for (const row of result.rows) {
      console.log(`\n${row.name} (${row.id})`);
      console.log('─'.repeat(50));

      const attrs = row.attributes;
      if (!attrs) {
        console.log('  ⚠️  没有 attributes 数据');
        continue;
      }

      // 检查关键字段
      console.log(`  运动模式: ${attrs.pattern || '⚠️ 缺失'}`);
      console.log(`  目标肌群: ${attrs.targets ? JSON.stringify(attrs.targets) : '⚠️ 缺失'}`);
      console.log(`  器械要求: ${attrs.equipment_required ? attrs.equipment_required.join(', ') : '⚠️ 缺失'}`);
      console.log(`  冲击水平: ${attrs.impact_level ? JSON.stringify(attrs.impact_level) : '⚠️ 缺失'}`);
      console.log(`  难度: ${attrs.difficulty || '⚠️ 缺失'}`);

      // 检查是否有教程内容
      if (attrs.content) {
        const preview = attrs.content.substring(0, 100).replace(/<[^>]*>/g, '');
        console.log(`  教程内容: ${preview}... (${attrs.content.length} 字符)`);
      } else {
        console.log('  教程内容: ⚠️ 缺失');
      }
    }

    console.log('\n========================================');

  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await pool.end();
  }
}

checkExerciseData();
