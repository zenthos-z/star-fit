import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'gemini_gym.db');

test.describe('User Profile E2E Tests', () => {
  test.beforeEach(async () => {
    const db = new Database(dbPath);
    const testUserId = 'e2e-test-user-' + Date.now();
    
    db.prepare(`
      INSERT OR REPLACE INTO user_insights (user_id, fitness_level, basic_info, preferences)
      VALUES (?, ?, ?, ?)
    `).run(testUserId, 'beginner', JSON.stringify({ age: 30, height: 175 }), JSON.stringify({ goal: '增肌' }));
    
    db.close();
  });

  test('should save user profile from UI', async ({ page }) => {
    await page.goto('/admin/users');
    
    await page.click('button:has-text("e2e-test-user-")');
    
    await page.fill('[name="age"]', '35');
    await page.fill('[name="height"]', '180');
    await page.fill('[name="weight"]', '75');
    
    await page.click('button:has-text("保存")');
    
    await expect(page.locator('.toast:has-text("保存成功")')).toBeVisible({ timeout: 5000 });
    
    const db = new Database(dbPath);
    const userIdPattern = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/e2e-test-user-\d+/);
      return match ? match[0] : null;
    });
    
    if (userIdPattern) {
      const profile = db.prepare('SELECT * FROM user_insights WHERE user_id LIKE ?')
        .get(userIdPattern + '%');
      
      expect(profile).toBeDefined();
      
      const basicInfo = JSON.parse(profile.basic_info);
      expect(basicInfo.age).toBe(35);
      expect(basicInfo.height).toBe(180);
      expect(basicInfo.weight).toBe(75);
    }
    
    db.close();
  });

  test('should persist data after page reload', async ({ page }) => {
    await page.goto('/admin/users');
    
    await page.click('button:has-text("e2e-test-user-")');
    
    const testAge = Math.floor(Math.random() * 50) + 20;
    const testHeight = Math.floor(Math.random() * 50) + 150;
    
    await page.fill('[name="age"]', String(testAge));
    await page.fill('[name="height"]', String(testHeight));
    
    await page.click('button:has-text("保存")');
    await expect(page.locator('.toast:has-text("保存成功")')).toBeVisible();
    
    await page.reload();
    
    await expect(page.locator('[name="age"]')).toHaveValue(String(testAge));
    await expect(page.locator('[name="height"]')).toHaveValue(String(testHeight));
  });

  test('should handle errors gracefully', async ({ page }) => {
    await page.goto('/admin/users');
    
    await page.click('button:has-text("e2e-test-user-")');
    
    await page.fill('[name="age"]', '-1');
    
    await page.click('button:has-text("保存")');
    
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText('age must be positive');
  });

  test('should export user data correctly', async ({ page, context }) => {
    await page.goto('/admin/users');
    
    await page.click('button:has-text("e2e-test-user-")');
    
    const testAge = 40;
    const testGoal = '力量提升';
    
    await page.fill('[name="age"]', String(testAge));
    await page.selectOption('[name="goal"]', testGoal);
    
    await page.click('button:has-text("保存")');
    await expect(page.locator('.toast:has-text("保存成功")')).toBeVisible();
    
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("导出数据")')
    ]);
    
    const filePath = await download.path();
    const content = await download.text();
    
    const exportedData = JSON.parse(content);
    expect(exportedData.basic_info.age).toBe(testAge);
    expect(exportedData.preferences.goal).toBe(testGoal);
  });

  test('should handle concurrent updates', async ({ page, context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    await page1.goto('/admin/users');
    await page2.goto('/admin/users');
    
    await page1.click('button:has-text("e2e-test-user-")');
    await page2.click('button:has-text("e2e-test-user-")');
    
    await page1.fill('[name="age"]', '25');
    await page2.fill('[name="age"]', '30');
    
    await page1.click('button:has-text("保存")');
    await page2.click('button:has-text("保存")');
    
    await expect(page1.locator('.toast:has-text("保存成功")').or(page2.locator('.toast:has-text("保存成功")'))).toBeVisible();
  });
});
