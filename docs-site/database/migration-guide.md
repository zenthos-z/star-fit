# PostgreSQL Migration Guide

**版本**: v2.0.0
**创建日期**: 2026-02-09
**状态**: Migration Instructions

---

## 概述

本文档描述从 SQLite 到 PostgreSQL 的迁移流程，以及 Core-Flex 架构的部署指南。

### 迁移策略

- **渐进式迁移**: 支持双写双读，逐步切换
- **零停机时间**: 通过影子迁移实现无缝切换
- **数据验证**: 每步都有验证检查点
- **回滚机制**: 支持快速回滚到 SQLite

---

## 迁移前准备

### 1. 环境要求

- PostgreSQL 14+
- Node.js 18+
- pgvector 扩展 (用于向量搜索)
- 足够的磁盘空间 (至少 2x 当前数据库大小)

### 2. 安装 pgvector 扩展

```sql
-- 连接到 PostgreSQL
CREATE EXTENSION IF NOT EXISTS vector;

-- 验证安装
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 3. 创建数据库

```sql
CREATE DATABASE starfit_prod
  WITH ENCODING 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TEMPLATE template0;

-- 连接到新数据库
\c starfit_prod

-- 创建扩展
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## 迁移步骤

### 阶段 1: Schema 创建 (5 分钟)

#### 1.1 执行 schema 创建脚本

```bash
cd backend
npm run migrate:schema
```

或手动执行:

```sql
-- 创建 user_profiles_v2 表
CREATE TABLE user_profiles_v2 (
  user_id UUID PRIMARY KEY,
  protocol_version VARCHAR(10) DEFAULT '2.0.0' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  profile_static JSONB DEFAULT '{}',
  profile_dynamic JSONB DEFAULT '{}',
  history_summary JSONB DEFAULT '{}',

  tags TEXT[] DEFAULT '{}',
  fitness_level VARCHAR(20) DEFAULT 'UNKNOWN',
  red_flags TEXT[] DEFAULT '{}',
  training_strategy TEXT,

  CONSTRAINT chk_protocol_version CHECK (protocol_version = '2.0.0'),
  CONSTRAINT chk_fitness_level CHECK (fitness_level IN (
    'UNKNOWN', 'beginner', 'intermediate', 'advanced'
  ))
);

-- 创建索引
CREATE INDEX idx_user_profiles_updated_at ON user_profiles_v2(updated_at DESC);
CREATE INDEX idx_user_profiles_fitness_level ON user_profiles_v2(fitness_level);
CREATE INDEX idx_user_profiles_tags ON user_profiles_v2 USING GIN(tags);
CREATE INDEX idx_profile_static ON user_profiles_v2 USING GIN(profile_static);
CREATE INDEX idx_profile_dynamic ON user_profiles_v2 USING GIN(profile_dynamic);
CREATE INDEX idx_history_summary ON user_profiles_v2 USING GIN(history_summary);

-- 创建其他表 (workout_sessions, exercises, agent_interactions)
-- 详见 postgresql-schema.md
```

#### 1.2 验证 schema

```bash
npm run validate:schema
```

### 阶段 2: 数据迁移 (30-60 分钟)

#### 2.1 配置迁移脚本

编辑 `backend/src/scripts/migrate/postgres-migrator.ts`:

```typescript
const config = {
  sqlitePath: './gemini_gym.db',
  postgresUrl: process.env.DATABASE_URL,
  batchSize: 1000,
  concurrentBatches: 3
};
```

#### 2.2 执行迁移

```bash
# 干跑模式 (不实际写入)
npm run migrate:dry-run

# 实际迁移
npm run migrate:to-postgres

# 验证迁移
npm run migrate:verify
```

#### 2.3 迁移进度监控

迁移脚本会输出进度:

```
[进度] user_insights: 1500/5000 (30%)
[进度] sessions: 800/2000 (40%)
[进度] exercises: 100/100 (100%)
```

### 阶段 3: 双写验证 (1-2 周)

#### 3.1 启用双写模式

配置 `.env`:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/starfit_prod
DB_MODE=dual-write  # 双写模式
DUAL_WRITE_DURATION_DAYS=14
```

#### 3.2 监控数据一致性

```bash
# 检查数据一致性
npm run migrate:check-consistency

# 输出示例:
# ✓ user_insights: 100% 一致
# ✓ sessions: 100% 一致
# ⚠ exercises: 99.8% 一致 (2 条记录差异)
```

#### 3.3 处理不一致数据

```bash
# 同步不一致的记录
npm run migrate:sync-inconsistent
```

### 阶段 4: 切换到 PostgreSQL (5 分钟)

#### 4.1 切换数据库模式

配置 `.env`:

```env
DB_MODE=postgres  # 仅使用 PostgreSQL
```

#### 4.2 重启服务

```bash
# 停止服务
npm run stop

# 启动服务
npm run start
```

#### 4.3 验证服务

```bash
# 健康检查
curl http://localhost:3000/api/health

# 预期输出:
# {
#   "status": "healthy",
#   "database": "postgresql",
#   "version": "2.0.0"
# }
```

### 阶段 5: 清理 SQLite (可选)

确认 PostgreSQL 稳定运行 1 周后:

```bash
# 归档 SQLite 文件
mv gemini_gym.db archive/gemini_gym.db.backup

# 或删除
rm gemini_gym.db
```

---

## 数据映射

### SQLite → PostgreSQL 字段映射

#### user_insights → user_profiles_v2

| SQLite 字段 | PostgreSQL 字段 | 转换逻辑 |
|-------------|-----------------|----------|
| user_id | user_id | 直接映射 |
| fitness_level | fitness_level | 直接映射 |
| load_anchors | profile_dynamic.load_anchors | JSONB 嵌套 |
| basic_info | profile_static.{age, weight, height} | JSONB 拆分 |
| physiological | profile_dynamic.recovery_state | JSONB 映射 |
| red_flags | red_flags | TEXT[] 转换 |

#### sessions → workout_sessions

| SQLite 字段 | PostgreSQL 字段 | 转换逻辑 |
|-------------|-----------------|----------|
| id | id | UUID 转换 |
| raw_json | exercises | JSON 解析 |
| timestamp | start_time | 时间戳转换 |

---

## 回滚计划

### 快速回滚 (5 分钟)

如果迁移后出现问题:

```bash
# 1. 切换回 SQLite
export DB_MODE=sqlite

# 2. 重启服务
npm run stop && npm run start

# 3. 验证
curl http://localhost:3000/api/health
```

### 数据同步回滚

如果需要回滚 PostgreSQL 数据到 SQLite:

```bash
# 从 PostgreSQL 同步到 SQLite
npm run migrate:sync-back-to-sqlite
```

---

## 性能优化

### PostgreSQL 配置优化

编辑 `postgresql.conf`:

```ini
# 内存配置
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB

# 查询优化
random_page_cost = 1.1
effective_io_concurrency = 200

# 连接配置
max_connections = 100

# WAL 配置
wal_buffers = 16MB
checkpoint_completion_target = 0.9
```

### 索引优化

```sql
-- 分析查询性能
EXPLAIN ANALYZE
SELECT * FROM user_profiles_v2
WHERE fitness_level = 'intermediate';

-- 创建特定索引
CREATE INDEX idx_user_profiles_composite
ON user_profiles_v2(fitness_level, updated_at DESC);
```

---

## 故障排除

### 常见问题

#### 1. pgvector 扩展未安装

**错误**: `type "vector" does not exist`

**解决**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### 2. UUID 生成失败

**错误**: `function gen_random_uuid() does not exist`

**解决**:
```sql
-- PostgreSQL 13+
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 或使用 uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

#### 3. JSONB 查询慢

**解决**:
```sql
-- 创建 GIN 索引
CREATE INDEX idx_profile_dynamic_gin
ON user_profiles_v2 USING GIN(profile_dynamic);

-- 使用 JSONB 路径表达式
SELECT * FROM user_profiles_v2
WHERE profile_dynamic->'load_anchors' ? '深蹲';
```

---

## 验证清单

迁移完成后，验证以下项目:

- [ ] 所有表创建成功
- [ ] 所有索引创建成功
- [ ] 数据记录数一致
- [ ] 随机抽样数据验证
- [ ] API 端点响应正常
- [ ] 性能基准测试通过
- [ ] 向量搜索功能正常
- [ ] 备份恢复测试通过

---

## 监控指标

迁移后监控以下指标:

```sql
-- 查询表大小
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 查询索引使用情况
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- 查询慢查询
SELECT
  query,
  mean_exec_time,
  calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0.0 | 2026-02-09 | PostgreSQL 迁移指南 |
| v1.0.0 | 2026-01-29 | 初始版本 |

---

**文档版本**: v2.0.0
**最后更新**: 2026-02-09
**维护者**: Starfit Development Team
