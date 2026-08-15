#!/usr/bin/env node

/**
 * 初始化测试用户到 PostgreSQL 数据库
 *
 * 运行方式: node scripts/init-test-users.js
 */

import { getPostgresClient } from '../dist/db/postgresql/index.js';

const TEST_USERS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    device_id: 'test-device-001',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    device_id: 'test-device-002',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    device_id: 'test-device-003',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    device_id: 'test-device-004',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    device_id: 'test-device-005',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000006',
    device_id: 'test-device-006',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000007',
    device_id: 'test-device-007',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000008',
    device_id: 'test-device-008',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000009',
    device_id: 'test-device-009',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  },
  {
    id: '00000000-0000-0000-0000-000000000010',
    device_id: 'test-device-010',
    profile_static: {},
    profile_dynamic: {},
    history_summary: {}
  }
];

async function initTestUsers() {
  console.log('🔄 初始化测试用户到 PostgreSQL...\n');

  const pg = getPostgresClient();

  for (const user of TEST_USERS) {
    try {
      // 使用 INSERT ... ON CONFLICT (UPSERT) 语法
      await pg.query(`
        INSERT INTO users (id, device_id, profile_static, profile_dynamic, history_summary, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          device_id = EXCLUDED.device_id,
          updated_at = NOW()
      `, [user.id, user.device_id, user.profile_static, user.profile_dynamic, user.history_summary]);

      console.log(`✅ 用户 ${user.id} 创建/更新成功`);
    } catch (error) {
      console.error(`❌ 用户 ${user.id} 创建失败:`, error.message);
    }
  }

  console.log('\n✨ 测试用户初始化完成！');

  await pg.end();
}

initTestUsers().catch(console.error);
