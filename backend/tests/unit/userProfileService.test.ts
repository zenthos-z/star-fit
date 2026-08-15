import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

describe('UserProfileService (Basic Tests)', () => {
  let testDbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    // Use process.cwd() instead of __dirname for Jest compatibility
    const testDir = process.cwd();
    testDbPath = path.join(testDir, 'test_db_' + Date.now() + '.db');
    db = new Database(testDbPath);

    // Set test environment variables for database connection
    process.env.DATABASE_PATH = testDbPath;

    db.exec(`
      CREATE TABLE user_insights (
        user_id TEXT PRIMARY KEY,
        fitness_level TEXT,
        basic_info TEXT,
        preferences TEXT,
        load_anchors TEXT,
        updated_at INTEGER,
        modified_by TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Database Operations', () => {
    it('should create and query user profile', () => {
      const basicInfo = JSON.stringify({ age: 30, height: 175 });

      db.prepare(`
        INSERT INTO user_insights (user_id, fitness_level, basic_info)
        VALUES (?, ?, ?)
      `).run('test-user', 'beginner', basicInfo);

      const profile = db.prepare('SELECT * FROM user_insights WHERE user_id = ?').get('test-user');

      expect(profile).toBeDefined();
      expect(profile.user_id).toBe('test-user');
      expect(profile.fitness_level).toBe('beginner');
      expect(JSON.parse(profile.basic_info)).toEqual({ age: 30, height: 175 });
    });

    it('should update existing profile', () => {
      // First create a profile
      db.prepare(`
        INSERT INTO user_insights (user_id, fitness_level, basic_info)
        VALUES (?, ?, ?)
      `).run('test-user', 'beginner', JSON.stringify({ age: 30 }));

      // Then update it
      db.prepare(`
        UPDATE user_insights
        SET fitness_level = ?, basic_info = ?
        WHERE user_id = ?
      `).run('advanced', JSON.stringify({ age: 31 }), 'test-user');

      const updated = db.prepare('SELECT * FROM user_insights WHERE user_id = ?').get('test-user');
      expect(updated.fitness_level).toBe('advanced');
      expect(JSON.parse(updated.basic_info)).toEqual({ age: 31 });
    });

    it('should return null when user does not exist', () => {
      const profile = db.prepare('SELECT * FROM user_insights WHERE user_id = ?').get('nonexistent-user');
      expect(profile).toBeUndefined();
    });
  });

  describe('JSON Data Handling', () => {
    it('should handle complex JSON in load_anchors', () => {
      const loadAnchors = JSON.stringify({
        squat: { load: 100, rpe: 8 },
        bench_press: { load: 80, rpe: 7 }
      });

      db.prepare(`
        INSERT INTO user_insights (user_id, load_anchors)
        VALUES (?, ?)
      `).run('test-user', loadAnchors);

      const profile = db.prepare('SELECT * FROM user_insights WHERE user_id = ?').get('test-user');
      const anchors = JSON.parse(profile.load_anchors);

      expect(anchors).toHaveProperty('squat');
      expect(anchors.squat.load).toBe(100);
      expect(anchors.bench_press.load).toBe(80);
    });
  });
});
