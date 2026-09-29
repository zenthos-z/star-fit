/**
 * assetPreconnect 单测（T6 视频加载优化）
 * 覆盖：绝对 https URL 注入 preconnect+dns-prefetch、同 origin 幂等、
 *       不同 origin 各自注入、相对/非法 URL 静默忽略
 *
 * 注：模块内 warmed Set 跨用例存活（幂等去重正赖于此），故各用例使用
 * 独立 origin，避免用例间状态串扰。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { preconnectAssetOrigin } from '../assetPreconnect';

const linksFor = (origin: string) =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link')).filter(
    l => l.href === `${origin}/` || l.href === origin,
  );

describe('preconnectAssetOrigin', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]').forEach(
      l => l.remove(),
    );
  });

  it('绝对 https URL：注入 preconnect + dns-prefetch 两条提示', () => {
    const origin = 'https://assets-basic.example.com';
    expect(preconnectAssetOrigin(`${origin}/exercise-videos/male/foo.mp4`)).toBe(origin);
    const rels = linksFor(origin).map(l => l.rel);
    expect(rels).toContain('preconnect');
    expect(rels).toContain('dns-prefetch');
  });

  it('同一 origin 幂等：重复调用不追加 link', () => {
    const origin = 'https://assets-idem.example.com';
    preconnectAssetOrigin(`${origin}/a.mp4`);
    const first = linksFor(origin).length;
    expect(first).toBeGreaterThan(0); // 首次确实注入
    expect(preconnectAssetOrigin(`${origin}/other/poster.jpg`)).toBe(origin);
    expect(linksFor(origin).length).toBe(first); // 二次调用零追加
  });

  it('不同 origin 各自注入（视频源与海报源分离场景）', () => {
    const originA = 'https://assets-video.example.com';
    const originB = 'https://assets-poster.example.com';
    preconnectAssetOrigin(`${originA}/v.mp4`);
    preconnectAssetOrigin(`${originB}/p.jpg`);
    expect(linksFor(originA).some(l => l.rel === 'preconnect')).toBe(true);
    expect(linksFor(originB).some(l => l.rel === 'preconnect')).toBe(true);
  });

  it('相对路径 / 非 http(s) / 空值：静默忽略，不注入任何 link', () => {
    expect(preconnectAssetOrigin('/uploads/video.mp4')).toBeNull();
    expect(preconnectAssetOrigin('data:text/plain,xxx')).toBeNull();
    expect(preconnectAssetOrigin('')).toBeNull();
    expect(preconnectAssetOrigin(null)).toBeNull();
    expect(document.head.querySelectorAll('link[rel="preconnect"]').length).toBe(0);
  });
});
