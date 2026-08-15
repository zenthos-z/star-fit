import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  SELECT id, name, 
    CASE 
      WHEN LENGTH(content_html) > 0 THEN SUBSTRING(content_html, 1, 500)
      ELSE '(无内容)'
    END as content_preview,
    CASE 
      WHEN content_html LIKE '%肩部%' THEN '包含肩部'
      ELSE '不包含肩部'
    END as has_shoulder,
    CASE 
      WHEN content_html LIKE '%友好%' THEN '包含友好'
      ELSE '不包含友好'
    END as has_friendly,
    CASE 
      WHEN content_html LIKE '%冲击%' THEN '包含冲击'
      ELSE '不包含冲击'
    END as has_impact
  FROM exercises
  WHERE embedding IS NOT NULL
  ORDER BY name
`)
  .then(res => {
    console.log('教程内容关键词检查:');
    console.table(res.rows);
    pool.end();
  })
  .catch(err => {
    console.error(err);
    pool.end();
  });
