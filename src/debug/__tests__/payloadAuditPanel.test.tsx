/**
 * PayloadAuditPanel 组件测试（issue #96）——列表/详情/校验态渲染冒烟。
 *
 * 覆盖：
 * - 列表：行渲染（时间/动作数）+ 过/拒徽标 + 分页控件（total > pageSize 时）
 * - 详情：校验结果 banner、四分区 + 预处理分区可见、原始 JSON 展开
 * - 拒付态：红色 code/reason 标注
 * - 无兜底：拉取失败原样展示错误详情（不出空态占位）
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, afterEach } from 'vitest';
import { PayloadAuditPanel } from '../PayloadAuditPanel';

// jsdom 无原生 fetch 产物依赖：桩掉面板的数据面（getHeaders 走 localStorage）
vi.mock('../../services/geminiService', () => ({
  API_BASE: 'http://test-api',
  getHeaders: () => ({ 'X-User-Id': 'test-user' }),
}));

const makeListResponse = (snapshots: Array<Record<string, unknown>>, total: number) => ({
  snapshots,
  total,
  limit: 20,
  offset: 0,
});

const passRow = {
  session_id: 'sess-pass-0001',
  start_time: '2026-10-01T08:30:00.000Z',
  end_time: '2026-10-01T09:25:00.000Z',
  title: '杠铃深蹲/跑步机慢跑',
  exercise_count: 2,
  validation_passed: true,
  validation_code: 'ok',
  snapshotted_at: '2026-10-01T09:26:00.000Z',
  updated_at: '2026-10-01T09:26:00.000Z',
};

const rejectRow = {
  ...passRow,
  session_id: 'sess-reject-0002',
  title: '坏数据训练',
  validation_passed: false,
  validation_code: 'reference',
};

const passDetail = {
  session_id: 'sess-pass-0001',
  user_id: 'user-1',
  start_time: '2026-10-01T08:30:00.000Z',
  end_time: '2026-10-01T09:25:00.000Z',
  title: '杠铃深蹲/跑步机慢跑',
  exercise_count: 2,
  validation_passed: true,
  validation: {
    ok: true,
    code: 'ok',
    reason: null,
    reference_check: 'applied',
    checked_at: '2026-10-01T09:26:00.000Z',
  },
  payload: {
    session_id: 'sess-pass-0001',
    start_time: '2026-10-01T08:30:00.000Z',
    end_time: '2026-10-01T09:25:00.000Z',
    exercises: [
      {
        exercise_id: 'ex-squat',
        name: '杠铃深蹲',
        type: 'resistance',
        sets: [
          { index: 0, weight: 60, reps: 8, rpe: 7, status: 'completed', timestamp: '2026-10-01T08:35:00.000Z', feel: 62, feel_note: '状态不错' },
          { index: 1, weight: 65, reps: 8, status: 'completed', timestamp: '2026-10-01T08:42:00.000Z', feel: 48 },
        ],
      },
      {
        exercise_id: 'ex-run',
        name: '跑步机慢跑',
        type: 'cardio',
        sets: [
          { index: 0, duration: 900, distance: 2400, status: 'completed', timestamp: '2026-10-01T09:00:00.000Z', feel: 70 },
        ],
      },
    ],
    stats: { totalVolume: 1000, setsCount: 3 },
    notes: '最后一组深蹲膝盖有点不舒服',
  },
  preprocess: [
    { exercise_index: 0, set_index: 0, timestamp_source: 'completed_at', status_normalized: 'completed', status_original: 'COMPLETED' },
    { exercise_index: 0, set_index: 1, timestamp_source: 'inferred', status_normalized: 'completed', status_original: null },
  ],
  snapshotted_at: '2026-10-01T09:26:00.000Z',
  updated_at: '2026-10-01T09:26:00.000Z',
};

const rejectDetail = {
  ...passDetail,
  session_id: 'sess-reject-0002',
  validation_passed: false,
  validation: {
    ok: false,
    code: 'reference',
    reason: '动作引用不在动作库内: exercise_id=bogus-id (name=杠铃深蹲)',
    reference_check: 'applied',
    checked_at: '2026-10-01T09:26:00.000Z',
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PayloadAuditPanel · 列表', () => {
  it('渲染快照行：时间/标题/动作数 + 过/拒徽标', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeListResponse([passRow, rejectRow], 2)), { status: 200 }),
    );
    render(<PayloadAuditPanel />);
    expect(await screen.findByTestId('payload-row-sess-pass-0001')).toBeInTheDocument();
    expect(screen.getByTestId('payload-row-sess-reject-0002')).toBeInTheDocument();
    expect(screen.getByTestId('badge-pass')).toBeInTheDocument();
    expect(screen.getByTestId('badge-reject')).toBeInTheDocument();
    expect(screen.getAllByText(/2 动作/)).toHaveLength(2);
    // 不足一页不出分页
    expect(screen.queryByTestId('payload-pager')).not.toBeInTheDocument();
  });

  it('total > pageSize 时出分页控件 + 翻页带 offset', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeListResponse([passRow], 25)), { status: 200 }),
    );
    render(<PayloadAuditPanel />);
    await screen.findByTestId('payload-pager');
    expect(screen.getByTestId('payload-page-info').textContent).toBe('1–20 / 25');
    fireEvent.click(screen.getByTestId('payload-next'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://test-api/debug/agent-payloads?limit=20&offset=20',
        expect.objectContaining({ headers: expect.anything() }),
      );
    });
  });

  it('拉取失败：无兜底，原样展示错误详情', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    );
    render(<PayloadAuditPanel />);
    const err = await screen.findByTestId('payload-error');
    expect(err.textContent).toContain('HTTP 500');
    expect(err.textContent).toContain('boom');
  });

  it('契约校验失败：报错不渲染行', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshots: 'not-an-array' }), { status: 200 }),
    );
    render(<PayloadAuditPanel />);
    const err = await screen.findByTestId('payload-error');
    expect(err.textContent).toContain('契约校验失败');
  });
});

describe('PayloadAuditPanel · 详情', () => {
  it('四分区 + 预处理分区 + 校验 banner + 原始 JSON 展开', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeListResponse([passRow], 1)), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(passDetail), { status: 200 }),
    );
    render(<PayloadAuditPanel />);
    fireEvent.click(await screen.findByTestId('payload-row-sess-pass-0001'));

    expect(await screen.findByTestId('payload-validation')).toBeInTheDocument();
    expect(screen.getByTestId('badge-pass')).toBeInTheDocument();
    // 四分区 + 预处理
    expect(screen.getByTestId('section-card-data')).toBeInTheDocument();
    expect(screen.getByTestId('section-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('section-relation')).toBeInTheDocument();
    expect(screen.getByTestId('section-feel')).toBeInTheDocument();
    expect(screen.getByTestId('section-preprocess')).toBeInTheDocument();
    // 感受序列：feel 曲线 + note 文本
    expect(screen.getByTestId('feel-curve')).toBeInTheDocument();
    expect(screen.getByText(/状态不错/)).toBeInTheDocument();
    // notes / stats 字段可见
    expect(screen.getByText(/最后一组深蹲膝盖有点不舒服/)).toBeInTheDocument();
    // 原始 JSON 展开
    fireEvent.click(screen.getByTestId('payload-json-toggle'));
    const rawSection = await screen.findByTestId('payload-raw');
    expect(rawSection.querySelector('pre')).toBeTruthy();
  });

  it('拒付态：红色 code/reason 标注可见', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeListResponse([rejectRow], 1)), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(rejectDetail), { status: 200 }),
    );
    render(<PayloadAuditPanel />);
    fireEvent.click(await screen.findByTestId('payload-row-sess-reject-0002'));

    const banner = await screen.findByTestId('payload-validation');
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId('badge-reject')).toBeInTheDocument();
    expect(banner.textContent).toContain('reference');
    expect(banner.textContent).toContain('bogus-id');
    // 拒付详情仍可回看结构化分区（payload 为归一形态）
    expect(screen.getByTestId('section-card-data')).toBeInTheDocument();
  });

  it('返回列表 + 详情 404 无兜底报错', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeListResponse([passRow], 1)), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Snapshot not found' }), { status: 404 }),
    );
    render(<PayloadAuditPanel />);
    fireEvent.click(await screen.findByTestId('payload-row-sess-pass-0001'));
    const err = await screen.findByTestId('payload-error');
    expect(err.textContent).toContain('HTTP 404');
    fireEvent.click(screen.getByTestId('payload-back'));
    expect(await screen.findByTestId('payload-list')).toBeInTheDocument();
  });
});
