/**
 * Create user_insights VIEW if it doesn't exist
 * This VIEW combines users table with profile data
 */

import { getPostgresClient } from '../client/postgres-client.js';

export async function createUserInsightsView() {
  const client = getPostgresClient();

  console.log('[Migration] Creating user_insights VIEW...');

  // Check if VIEW already exists
  const checkResult = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.views
      WHERE table_name = 'user_insights'
    )
  `);

  const exists = checkResult.rows[0]?.exists;

  if (exists) {
    console.log('[Migration] user_insights VIEW already exists, skipping.');
    return;
  }

  // Create the VIEW
  await client.query(`
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
    LEFT JOIN user_insights ui ON u.id = ui.user_id
  `);

  console.log('[Migration] user_insights VIEW created successfully!');
}
