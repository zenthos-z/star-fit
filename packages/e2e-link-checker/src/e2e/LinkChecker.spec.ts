import { test, expect } from '@playwright/test';
import { Issue } from '../types';

test.describe('E2E链路一致性检测', () => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:5173';

  test('封面显示检测', async ({ page }) => {
    await page.goto(`${baseUrl}/admin/actions`);
    
    const coverImages = await page.locator('img[alt*="cover"], img[alt*="封面"]').all();
    const issues: Issue[] = [];

    for (const img of coverImages) {
      const src = await img.getAttribute('src');
      if (src && !src.startsWith('http')) {
        issues.push({
          type: 'relative-url',
          severity: 'error',
          message: `发现相对URL: ${src}`,
          location: `E2E: 封面图片`,
          suggestion: '使用getFullUrl函数解析URL',
          code: src
        });
      }
    }

    if (issues.length > 0) {
      console.error('封面显示检测发现问题:');
      issues.forEach(issue => console.error(`  - ${issue.message}`));
    }

    expect(issues.length).toBe(0);
  });

  test('视频预览检测', async ({ page }) => {
    await page.goto(`${baseUrl}/admin/actions`);
    
    const videoElements = await page.locator('video').all();
    const issues: Issue[] = [];

    for (const video of videoElements) {
      const src = await video.getAttribute('src');
      if (src && !src.startsWith('http')) {
        issues.push({
          type: 'relative-url',
          severity: 'error',
          message: `发现相对URL: ${src}`,
          location: `E2E: 视频元素`,
          suggestion: '使用getFullUrl函数解析URL',
          code: src
        });
      }
    }

    if (issues.length > 0) {
      console.error('视频预览检测发现问题:');
      issues.forEach(issue => console.error(`  - ${issue.message}`));
    }

    expect(issues.length).toBe(0);
  });

  test('教程内容获取检测', async ({ page }) => {
    await page.goto(`${baseUrl}/app/workout`);
    
    await page.waitForSelector('[data-testid="tutorial-button"], button:has-text("教程")', { timeout: 5000 });
    
    const tutorialButton = page.locator('[data-testid="tutorial-button"], button:has-text("教程")').first();
    
    try {
      await tutorialButton.click();
      
      await page.waitForSelector('[data-testid="tutorial-content"], .tutorial-content', { timeout: 5000 });
      
      const tutorialContent = page.locator('[data-testid="tutorial-content"], .tutorial-content');
      const isVisible = await tutorialContent.isVisible();
      
      if (!isVisible) {
        console.error('教程内容未显示');
      }
      
      expect(isVisible).toBe(true);
    } catch (error) {
      console.error('教程内容获取检测失败:', error);
      throw error;
    }
  });

  test('WebSocket连接检测', async ({ page }) => {
    const wsMessages: string[] = [];
    let wsConnected = false;

    page.on('websocket', ws => {
      wsConnected = true;
      ws.on('framereceived', frame => {
        wsMessages.push(frame.payload.toString());
      });
    });

    await page.goto(`${baseUrl}/admin/actions`);
    
    await page.waitForTimeout(2000);

    if (!wsConnected) {
      console.warn('WebSocket连接未建立');
    }

    expect(wsConnected).toBeTruthy();
  });
});
