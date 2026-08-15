#!/usr/bin/env tsx
/**
 * Simple PostgreSQL Connection Test
 */

import pg from 'pg';

const { Pool } = pg;

async function testConnection() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'starfit',
    user: 'postgres',
    password: 'postgres',
  });

  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL连接成功');

    // Test basic query
    const result = await client.query('SELECT NOW() as now, version() as version');
    console.log('📅 数据库时间:', result.rows[0].now.toISOString());
    console.log('🔧 PostgreSQL版本:', result.rows[0].version.split(' ')[1]);

    // List tables
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    console.log(`📊 已创建 ${tables.rows.length} 张表:`);
    tables.rows.forEach(row => console.log('   -', row.tablename));

    // Check pgvector extension
    const vectorExt = await client.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'");
    if (vectorExt.rows.length > 0) {
      console.log(`✅ pgvector扩展 v${vectorExt.rows[0].extversion} 已安装`);
    } else {
      console.log('⚠️  pgvector扩展未安装');
    }

    // Check vector column in exercises table
    const exercisesSchema = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'exercises' AND column_name = 'embedding'
    `);
    if (exercisesSchema.rows.length > 0) {
      console.log('✅ exercises表包含embedding向量列:', exercisesSchema.rows[0].data_type);
    }

    client.release();
    await pool.end();
    console.log('✅ 测试完成');
  } catch (error) {
    console.error('❌ 连接失败:', error);
    process.exit(1);
  }
}

testConnection();
