/**
 * 检查 exercises 表中的 bench_press 数据
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

import { getPostgresClient, closePostgresClient } from '../db/postgresql/index.js';

async function checkExercise() {
  console.log('=== 检查 bench_press 动作数据 ===\n');

  const client = getPostgresClient();

  const result = await client.query(`
    SELECT
      id,
      name,
      assets_json,
      created_at,
      updated_at,
      modified_at
    FROM exercises
    WHERE id = 'bench_press'
  `);

  if (result.rows.length === 0) {
    console.log('❌ 未找到 bench_press 动作');
    process.exit(1);
  }

  const exercise = result.rows[0];
  console.log('✓ 找到动作:');
  console.log('  - id:', exercise.id);
  console.log('  - name:', exercise.name);
  console.log('  - created_at:', exercise.created_at);
  console.log('  - updated_at:', exercise.updated_at);
  console.log('  - modified_at:', exercise.modified_at);
  console.log('\n  - assets_json:');

  let assets;
  try {
    assets = typeof exercise.assets_json === 'string'
      ? JSON.parse(exercise.assets_json)
      : exercise.assets_json;
  } catch (e) {
    console.log('  ❌ 解析失败:', exercise.assets_json);
    assets = { error: 'parse failed' };
  }

  console.log(JSON.stringify(assets, null, 2));

  if (assets.video && Array.isArray(assets.video) && assets.video.length > 0) {
    console.log(`\n✓ 有 ${assets.video.length} 个视频:`);
    assets.video.forEach((v: any, i: number) => {
      console.log(`  ${i + 1}. id: ${v.id}`);
      console.log(`     baseUrl: ${v.baseUrl}`);
      console.log(`     posterUrl: ${v.posterUrl}`);
    });
  } else {
    console.log('\n❌ 没有视频数据');
    console.log('  assets.video =', assets.video);
  }

  if (assets.cover) {
    console.log(`\n✓ 有封面图: ${assets.cover}`);
  } else {
    console.log('\n❌ 没有封面图');
  }

  await closePostgresClient();
  process.exit(0);
}

checkExercise().catch(err => {
  console.error('查询失败:', err);
  process.exit(1);
});
