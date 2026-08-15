import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSchema() {
  console.log('========================================');
  console.log('Exercises 表结构');
  console.log('========================================\n');

  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'exercises'
      ORDER BY ordinal_position
    `);

    console.log('列信息:');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    }

    console.log('\n========================================');
  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await pool.end();
  }
}

checkSchema();
