/**
 * VideoPlayerModal（v4 重写）单测：安全区结构 / 播放器下方多版本预览条 / 源切换
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoPlayerModal } from '../execution/VideoPlayerModal';

const VIDEOS = [
  { url: 'https://r2.example/male.mp4', poster: 'https://r2.example/poster-male.jpg', label: '男版演示' },
  { url: 'https://r2.example/female.mp4', poster: 'https://r2.example/poster-female.jpg', label: '女版演示' },
];

describe('VideoPlayerModal · v4 重写', () => {
  it('未打开时不渲染', () => {
    const { container } = render(<VideoPlayerModal isOpen={false} onClose={() => {}} videos={VIDEOS} />);
    expect(container.querySelector('video')).toBeNull();
  });

  it('渲染播放器 + 安全区顶栏 + 播放器下方预览图条（male/female 双版本）', () => {
    render(<VideoPlayerModal isOpen onClose={() => {}} title="杠铃卧推" videos={VIDEOS} />);
    // 播放器源默认取第一个
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toContain('male.mp4');
    // 顶部栏在固定容器首位（safe-area 避让为内联 env() 样式，jsdom 不解析 → 以截图门验证）
    const topBar = screen.getByLabelText('关闭视频').parentElement!;
    expect(topBar.tagName).toBe('DIV');
    // 预览条：两个版本各一张预览图，位于播放器下方
    expect(screen.getByRole('button', { name: '男版演示' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '女版演示' })).toBeInTheDocument();
    const strip = screen.getByRole('button', { name: '女版演示' }).closest('div.bg-black') as HTMLElement;
    expect(strip.querySelectorAll('img')).toHaveLength(2);
  });

  it('点按预览图切换视频源', async () => {
    const user = userEvent.setup();
    render(<VideoPlayerModal isOpen onClose={() => {}} videos={VIDEOS} />);
    await user.click(screen.getByRole('button', { name: '女版演示' }));
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toContain('female.mp4');
  });

  it('单视频不渲染预览条', () => {
    render(<VideoPlayerModal isOpen onClose={() => {}} videos={[VIDEOS[0]]} />);
    expect(screen.queryByRole('button', { name: '女版演示' })).not.toBeInTheDocument();
  });
});
