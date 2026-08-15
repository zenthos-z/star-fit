-- 清理所有用户数据的脚本
-- 执行前请确保已备份数据库

-- 开始事务
BEGIN TRANSACTION;

-- 1. 清理用户级缓存表
DELETE FROM cache_history_summaries WHERE user_id != 'global';
DELETE FROM cache_rpe_stats WHERE user_id != 'global';

-- 2. 清理用户媒体
DELETE FROM user_media WHERE user_id IN (SELECT id FROM users);

-- 3. 清理偏差日志
DELETE FROM deviation_logs WHERE user_id IN (SELECT id FROM users);

-- 4. 清理审计日志
DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users);

-- 5. 清理用户洞察
DELETE FROM user_insights WHERE user_id IN (SELECT id FROM users);

-- 6. 清理用户级配置（保留global配置）
DELETE FROM guidance WHERE user_id != 'global';
DELETE FROM app_configs WHERE user_id != 'global';
DELETE FROM prompt_style_configs WHERE user_id != 'global';

-- 7. 清理会话（会通过CASCADE删除rpe_logs）
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users);

-- 8. 最后删除用户
DELETE FROM users;

-- 提交事务
COMMIT;

-- 验证清理结果
SELECT 'Users remaining: ' || COUNT(*) as count FROM users;
SELECT 'Sessions remaining: ' || COUNT(*) as count FROM sessions;
SELECT 'RPE logs remaining: ' || COUNT(*) as count FROM rpe_logs;
