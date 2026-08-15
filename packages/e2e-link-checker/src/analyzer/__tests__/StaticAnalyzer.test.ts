import { StaticAnalyzer } from '../StaticAnalyzer';
import { Issue } from '../../types';

describe('StaticAnalyzer', () => {
  let analyzer: StaticAnalyzer;

  beforeEach(() => {
    analyzer = new StaticAnalyzer();
  });

  describe('相对URL检测', () => {
    it('应该检测到直接使用相对URL', () => {
      const code = `
        const assets = { cover: '/uploads/cover.jpg' };
        <img src={assets.cover} alt="cover" />
      `;
      const issues = analyzer.analyze('test.tsx', {
        rules: { relativeUrl: { enabled: true, severity: 'error' } }
      });

      expect(issues.some(i => i.type === 'relative-url')).toBe(true);
    });

    it('应该忽略使用getFullUrl的情况', () => {
      const code = `
        const assets = { cover: '/uploads/cover.jpg' };
        <img src={getFullUrl(assets.cover)} alt="cover" />
      `;
      const issues = analyzer.analyze('test.tsx', {
        rules: { relativeUrl: { enabled: true, severity: 'error' } }
      });

      expect(issues.some(i => i.type === 'relative-url')).toBe(false);
    });
  });

  describe('WebSocket事件处理检测', () => {
    it('应该检测到WebSocket完成事件缺少数据库更新', () => {
      const code = `
        ws.on('complete', () => {
          console.log('Video processing complete');
        });
      `;
      const issues = analyzer.analyze('test.ts', {
        rules: { webSocket: { enabled: true, severity: 'warning' } }
      });

      expect(issues.some(i => i.type === 'websocket')).toBe(true);
    });

    it('应该检测到数据库更新不在WebSocket回调中', () => {
      const code = `
        const uploadVideo = async () => {
          const taskId = await createTask(file);
          updateDatabaseUrl(taskId);
        };
      `;
      const issues = analyzer.analyze('test.ts', {
        rules: { webSocket: { enabled: true, severity: 'error' } }
      });

      expect(issues.some(i => i.type === 'websocket')).toBe(true);
    });
  });

  describe('数据查询降级检测', () => {
    it('应该检测到缺少多源查询和降级处理', () => {
      const code = `
        const exercise = await db.exercises.findFirst({
          where: { name: exerciseName },
        });
      `;
      const issues = analyzer.analyze('test.ts', {
        rules: { dataQuery: { enabled: true, severity: 'warning' } }
      });

      expect(issues.some(i => i.type === 'data-query')).toBe(true);
    });
  });

  describe('纵横比检测', () => {
    it('应该检测到aspect-video类', () => {
      const code = `
        <div className="aspect-video">
          <img src={cover} alt="cover" />
        </div>
      `;
      const issues = analyzer.analyze('test.tsx', {
        rules: { aspectRatio: { enabled: true, severity: 'warning' } }
      });

      expect(issues.some(i => i.type === 'aspect-ratio')).toBe(true);
    });
  });
});
