-- user_insights VIEW
-- Combines users table with profile data from user_insights table
-- This replaces the SQLite-based query logic

CREATE OR REPLACE VIEW user_insights AS
SELECT
  u.id AS user_id,
  u.created_at,
  u.updated_at,
  -- Core fields from user_insights table
  COALESCE(ui.fitness_level, 'beginner') AS fitness_level,
  COALESCE(ui.red_flags, '[]')::text AS red_flags,
  COALESCE(ui.summary, '') AS summary,
  -- Extended JSON fields
  COALESCE(ui.basic_info, NULL::text) AS basic_info,
  COALESCE(ui.preferences, NULL::text) AS preferences,
  COALESCE(ui.physiological, NULL::text) AS physiological,
  COALESCE(ui.psychological, NULL::text) AS psychological,
  COALESCE(ui.load_anchors, NULL::text) AS load_anchors,
  COALESCE(ui.training_strategy, NULL::text) AS training_strategy,
  -- Metadata
  COALESCE(ui.modified_by, 'system') AS modified_by,
  COALESCE(ui.protocol_version, NULL::text) AS protocol_version
FROM users u
LEFT JOIN user_insights ui ON u.id = ui.user_id;
