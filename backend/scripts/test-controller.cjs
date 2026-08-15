require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

async function simulateController() {
  const pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });

  const client = await pool.connect();

  try {
    const userId = '00000000-0000-0000-0000-000000000001';

    // Simulate what UserProfileService.getProfile does
    const result = await client.query(`SELECT * FROM user_insights WHERE user_id = $1`, [userId]);
    const profile = result.rows[0];

    console.log('=== Profile from VIEW ===');
    console.log('user_id:', profile.user_id);
    console.log('id:', profile.id);
    console.log('created_at:', profile.created_at);
    console.log('updated_at:', profile.updated_at);
    console.log('basic_info:', profile.basic_info);
    console.log('typeof basic_info:', typeof profile.basic_info);
    console.log('basic_info is truthy:', !!profile.basic_info);

    // Simulate the controller logic
    const safeParseJSON = (value) => {
      if (!value) return [];
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return []; }
      }
      return Array.isArray(value) ? value : [];
    };

    const userProfileV2 = {
      protocol_version: '2.0.0',
      user_id: profile.id || profile.user_id,
      profile_static: profile.basic_info ? {
        age: profile.basic_info.age,
        weight: profile.basic_info.weight,
        height: profile.basic_info.height,
        body_fat_percentage: profile.basic_info.body_fat,
        neuro_type: profile.psychological?.neurotype,
        risk_preference: profile.psychological?.risk_preference,
        accountability: profile.psychological?.accountability,
        permanent_injuries: [],
      } : {},
      tags: safeParseJSON(profile.red_flags),
      red_flags: safeParseJSON(profile.red_flags),
    };

    console.log('\n=== Controller output ===');
    console.log('profile_static:', JSON.stringify(userProfileV2.profile_static, null, 2));
    console.log('tags:', userProfileV2.tags);
    console.log('red_flags:', userProfileV2.red_flags);

  } finally {
    client.release();
    await pool.end();
  }
}

simulateController().catch(console.error);
