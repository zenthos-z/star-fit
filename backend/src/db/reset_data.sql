-- PURGE_V1_DATA: Database Reset Script (V2 Baseline Compliance)
-- 
-- Standard Alignment:
-- 1. [TECH_STANDARDS.md] Section 2.1 (Tolerance Parsing & Versioning)
-- 2. [DATA_PROTOCOL_STANDARD.md] Phase 0 (Cleanup) & Critical Compliance (ISO 8601)
-- 
-- CAUTION: This script clears all historical data to establish a clean V2 baseline.
-- All timestamps will henceforth be stored as ISO 8601 UTC strings.

PRAGMA foreign_keys = OFF;

-- Clear core tables
DELETE FROM rpe_logs;
DELETE FROM sessions;
DELETE FROM user_media;
DELETE FROM app_configs;
DELETE FROM prompt_style_configs;
DELETE FROM guidance;
DELETE FROM users;
DELETE FROM user_insights;
DELETE FROM exercises;
DELETE FROM deviation_logs;

-- Clear cache tables
DELETE FROM cache_history_summaries;
DELETE FROM cache_rpe_stats;

-- Reset auto-increment counters
DELETE FROM sqlite_sequence WHERE name IN ('rpe_logs', 'sessions', 'users', 'user_media', 'deviation_logs');

-- Vacuum to reclaim space
VACUUM;

PRAGMA foreign_keys = ON;

SELECT 'PURGE_V1_DATA: Backend database reset completed. V2 Protocol Baseline (ISO 8601) established.' as status;