/**
 * 检查 exercises 表中的数据
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

import { getPostgresClient } from '../../src/db/postgresql/index.js';

async function checkExercisesData() {
  const client = getPostgresClient();

  console.log('=== 检查 exercises 表数据 ===\n');

  // 1. 检查 bench_press 数据
  console.log('1. bench_press 动作数据:');
  const benchPress = await client.query(`
    SELECT
      id,
      name,
      exercise_type,
      attributes,
      attributes->'targets' as targets_extracted,
      attributes->'equipment_required' as equipment_extracted,
      difficulty,
      assets_json,
      modified_at,
      updated_at
    FROM exercises
    WHERE id = 'bench_press'
  `);

  if (benchPress.rows.length > 0) {
    console.log('   找到数据:');
    const row = benchPress.rows[0];
    console.log('   - id:', row.id);
    console.log('   - name:', row.name);
    console.log('   - exercise_type:', row.exercise_type);
    console.log('   - attributes:', row.attributes);
    console.log('   - targets (extracted):', row.targets_extracted);
    console.log('   - equipment_required (extracted):', row.equipment_extracted);
    console.log('   - difficulty:', row.difficulty);
    console.log('   - assets_json:', row.assets_json);
    console.log('   - modified_at:', row.modified_at);
    console.log('   - updated_at:', row.updated_at);
  } else {
    console.log('   ⚠️  未找到 bench_press');
  }

  // 2. 检查所有动作
  console.log('\n2. 所有动作列表:');
  const allExercises = await client.query(`
    SELECT
      id,
      name,
      exercise_type,
      attributes,
      attributes->'targets' as targets_extracted,
      attributes->'equipment_required' as equipment_extracted,
      difficulty
    FROM exercises
    ORDER BY name
    LIMIT 10
  `);

  console.log(`   总共 ${allExercises.rows.length} 个动作:`);
  allExercises.rows.forEach((row, idx) => {
    console.log(`   ${idx + 1}. [${row.id}] ${row.name} - ${row.exercise_type}`);
    console.log(`      targets: ${JSON.stringify(row.targets_extracted)}`);
    console.log(`      equipment: ${JSON.stringify(row.equipment_extracted)}`);
  });

  // 3. 检查是否有任何无效的 id
  console.log('\n3. 检查无效的 id:');
  const invalidIds = await client.query(`
    SELECT
      id,
      name
    FROM exercises
    WHERE id IS NULL
       OR id = ''
       OR id = 'null'
       OR id = 'undefined'
       OR trim(id) = ''
  `);

  if (invalidIds.rows.length > 0) {
    console.log(`   发现 ${invalidIds.rows.length} 个无效 id:`);
    invalidIds.rows.forEach(row => {
      console.log(`   - [${row.id}] ${row.name}`);
    });
  } else {
    console.log('   ✓ 没有无效 id');
  }

  process.exit(0);
}

checkExercisesData().catch(console.error);
