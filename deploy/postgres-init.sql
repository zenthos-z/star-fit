-- PostgreSQL 初始化脚本：postgres 容器首次启动时自动执行（/docker-entrypoint-initdb.d/）。
-- 基线 schema（postgres-init 命令）与增量迁移（003/004）的依赖在此准备。
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 迁移 003/004 的 user_insights 视图引用 ::fitness_level 类型转换，但该类型
-- 在仓库任何 schema/迁移脚本中都未创建（历史断裂，开发库中也不存在）。
-- 依据 shared/contracts 的 z.enum(['beginner','intermediate','advanced']) 在此补建。
CREATE TYPE fitness_level AS ENUM ('beginner', 'intermediate', 'advanced');

-- 基线 schema（schema.sql）自建了旧版 user_insights 视图，其列集与迁移 003 的版本
-- 冲突（CREATE OR REPLACE VIEW 不能减列）。迁移 004/006 均以 DROP VIEW 起手重建，
-- 此处先移除基线版，交由迁移链重建为最终版。
DROP VIEW IF EXISTS user_insights;

-- 迁移 003 文件内 view（L27）先于函数（L77）定义，干净库上 CREATE VIEW 会因
-- pgb_json_merge 不存在而失败。此处幂等预建同一定义。
CREATE OR REPLACE FUNCTION pgb_json_merge(a JSONB, b JSONB)
RETURNS JSONB AS $$
BEGIN
  IF a IS NULL THEN
    RETURN b;
  END IF;
  IF b IS NULL THEN
    RETURN a;
  END IF;
  RETURN a || b;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
