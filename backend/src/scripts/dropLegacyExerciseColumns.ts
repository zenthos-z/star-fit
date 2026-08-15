/**
 * 删除 exercises 表中的旧列（targets, equipment_required）
 * 这些数据已迁移到 attributes JSONB 中
 */

import dotenv from 'dotenv';
import { getPostgresClient } from '../db/postgresql/index.js';

// 加载环境变量
dotenv.config();

async function dropLegacyColumns() {
  const postgresClient = getPostgresClient();

  try {
    console.log('开始删除 exercises 表的旧列...');

    // 检查列是否存在
    const columnsCheck = await postgresClient.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'exercises'
      AND column_name IN ('targets', 'equipment_required')
    `);

    const existingColumns = columnsCheck.rows.map((r: any) => r.column_name);
    console.log('发现的旧列:', existingColumns);

    // 删除旧列
    for (const column of existingColumns) {
      console.log(`删除列: ${column}`);
      await postgresClient.query(`ALTER TABLE exercises DROP COLUMN IF EXISTS ${column}`);
    }

    if (existingColumns.length === 0) {
      console.log('没有发现需要删除的旧列');
    } else {
      console.log(`成功删除 ${existingColumns.length} 个旧列`);
    }

    // 显示当前表结构
    const columns = await postgresClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'exercises'
      ORDER BY ordinal_position
    `);

    console.log('\n当前 exercises 表结构:');
    console.table(columns.rows);

  } catch (error) {
    console.error('删除列时出错:', error);
    process.exit(1);
  }
}

dropLegacyColumns().then(() => {
  console.log('\n迁移完成');
  process.exit(0);
});
