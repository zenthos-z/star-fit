/**
 * T4 调试台 · Payload 审计面板（issue #96）。
 *
 * 训练后审计：每次训练一条快照（ingestion 链冻结的交付时点 normalize
 * payload + 硬校验结果 + 预处理标注），列表 → 详情回看——解决「黑盒不知道
 * 喂了什么」。实时流观测走 SSE 调试台，本页不做实时。
 *
 * 数据面：GET /api/debug/agent-payloads[/(:sessionId)]（快照 API，与
 * load_history 同源 normalize+validate 构造，非第二套口径）。
 *
 * 红线（分册4 §5.2）：只读；拉取失败直接报错展示详情，无空态兜底占位；
 * 校验失败项红色标注 + 原因可见。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE, getHeaders } from '../services/geminiService';
import {
  AgentPayloadListResponseSchema,
  AgentPayloadSnapshotDetailSchema,
  type AgentPayloadListResponse,
  type AgentPayloadSnapshotDetail,
  type AgentPayloadSnapshotListRow,
  type AgentSetPreprocessNote,
  type AgentDeliverySession,
} from 'shared/contracts';

// ============================================================================
// API 客户端（Zod 校验回路；失败即抛——本页无兜底）
// ============================================================================

async function fetchSnapshotList(
  limit: number,
  offset: number,
): Promise<AgentPayloadListResponse> {
  const res = await fetch(
    `${API_BASE}/debug/agent-payloads?limit=${limit}&offset=${offset}`,
    { headers: getHeaders({}, false) },
  );
  if (!res.ok) {
    throw new Error(`列表请求失败 HTTP ${res.status}: ${await res.text()}`);
  }
  const parsed = AgentPayloadListResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error('[PayloadAudit] list response failed schema validation', parsed.error.issues);
    throw new Error(`列表响应契约校验失败: ${parsed.error.issues[0]?.path.join('.') ?? 'root'}`);
  }
  return parsed.data;
}

async function fetchSnapshotDetail(sessionId: string): Promise<AgentPayloadSnapshotDetail> {
  const res = await fetch(
    `${API_BASE}/debug/agent-payloads/${encodeURIComponent(sessionId)}`,
    { headers: getHeaders({}, false) },
  );
  if (!res.ok) {
    throw new Error(`详情请求失败 HTTP ${res.status}: ${await res.text()}`);
  }
  const parsed = AgentPayloadSnapshotDetailSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error('[PayloadAudit] detail response failed schema validation', parsed.error.issues);
    throw new Error(`详情响应契约校验失败: ${parsed.error.issues[0]?.path.join('.') ?? 'root'}`);
  }
  return parsed.data;
}

// ============================================================================
// 展示小件
// ============================================================================

const fmtTime = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const VALIDATION_LABEL: Record<string, string> = {
  ok: '通过',
  unnormalizable: '不可归一',
  schema: '字段校验失败',
  reference: '动作引用不在库',
  set_indices: '组序号不连续',
  timestamp_order: '时间戳倒序',
};

const TS_SOURCE_LABEL: Record<AgentSetPreprocessNote['timestamp_source'], string> = {
  explicit: '显式',
  completed_at: 'completedAt',
  inferred: '推算 60s',
};

const TS_SOURCE_STYLE: Record<AgentSetPreprocessNote['timestamp_source'], string> = {
  explicit: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  completed_at: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  inferred: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

/** 校验状态徽标（列表行 + 详情 banner 共用） */
const ValidationBadge: React.FC<{ passed: boolean; code: string }> = ({ passed, code }) => (
  <span
    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap ${
      passed
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    }`}
    data-testid={`badge-${passed ? 'pass' : 'reject'}`}
  >
    {passed ? '✓ 校验通过' : `✗ ${VALIDATION_LABEL[code] ?? code}`}
  </span>
);

const Section: React.FC<{
  title: string;
  index?: string;
  children: React.ReactNode;
  'data-testid'?: string;
}> = ({ title, index, children, ...rest }) => (
  <section
    className="rounded-xl border border-white/10 bg-gray-900/60 p-3 space-y-2"
    {...rest}
  >
    <h3 className="text-[13px] font-bold text-gray-200 flex items-baseline gap-2">
      {index && <span className="text-[10px] font-mono text-sky-400">{index}</span>}
      {title}
    </h3>
    {children}
  </section>
);

const Field: React.FC<{ label: string; value: React.ReactNode; danger?: boolean }> = ({
  label,
  value,
  danger,
}) => (
  <div className="flex gap-2 text-[12px] leading-relaxed">
    <span className="text-gray-500 shrink-0 min-w-[72px]">{label}</span>
    <span className={`font-mono break-all ${danger ? 'text-rose-300' : 'text-gray-200'}`}>{value}</span>
  </div>
);

// ============================================================================
// 详情分区
// ============================================================================

/** 归一成功时 payload 的窄化读取（unnormalizable 行 payload = 原始输入，走 JSON 视图） */
const asDeliverySession = (payload: unknown): AgentDeliverySession | null => {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as AgentDeliverySession;
  return Array.isArray(candidate.exercises) ? candidate : null;
};

/** ① 卡片数据：exercises 逐动作汇总 + stats + notes（逐字段标注真源=快照 payload） */
const CardDataSection: React.FC<{ session: AgentDeliverySession }> = ({ session }) => (
  <Section title="卡片数据" index="①" data-testid="section-card-data">
    <div className="space-y-2">
      {session.exercises.map((ex, i) => {
        const sets = ex.sets ?? [];
        const completed = sets.filter(s => s.status === 'completed').length;
        return (
          <div key={`${ex.exercise_id}-${i}`} className="rounded-lg bg-gray-950/70 border border-white/5 p-2 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-gray-100">{i + 1}. {ex.name}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/25">{ex.type}</span>
              <span className="text-[10px] text-gray-500">{completed}/{sets.length} 组完成</span>
            </div>
            <Field label="exercise_id" value={ex.exercise_id} />
            <Field label="逐组" value={
              sets.length === 0
                ? '（无组）'
                : sets.map((s, j) => {
                    const parts: string[] = [`#${s.index}`];
                    if (s.weight !== undefined) parts.push(`${s.weight}kg`);
                    if (s.reps !== undefined) parts.push(`×${s.reps}`);
                    if (s.duration !== undefined) parts.push(`${s.duration}s`);
                    if (s.distance !== undefined) parts.push(`${s.distance}m`);
                    if (s.rpe !== undefined) parts.push(`rpe${s.rpe}`);
                    // heartRate 为透传存量键（非契约字段，值形态不定）
                    if (typeof s.heartRate === 'number') parts.push(`hr${s.heartRate}`);
                    parts.push(s.status);
                    return <span key={j} className="inline-block mr-1.5 font-mono text-[11px] text-gray-300">{parts.join(' ')}</span>;
                  })
            } />
          </div>
        );
      })}
    </div>
    {session.stats && Object.keys(session.stats).length > 0 && (
      <div className="rounded-lg bg-gray-950/70 border border-white/5 p-2 space-y-1">
        <div className="text-[11px] text-gray-400 font-semibold">stats（会话级真值，Service 层算好）</div>
        {Object.entries(session.stats).map(([k, v]) => (
          <Field key={k} label={k} value={JSON.stringify(v)} />
        ))}
      </div>
    )}
    {session.notes && <Field label="notes" value={session.notes} />}
  </Section>
);

/** ② 时间线关系：会话窗口 + 动作顺序 + 逐组时间戳（含预处理来源标注） */
const TimelineSection: React.FC<{
  session: AgentDeliverySession;
  preprocess: AgentSetPreprocessNote[];
}> = ({ session, preprocess }) => {
  const noteOf = (exIdx: number, setIdx: number) =>
    preprocess.find(n => n.exercise_index === exIdx && n.set_index === setIdx);
  return (
    <Section title="时间线关系" index="②" data-testid="section-timeline">
      <Field label="会话窗口" value={`${session.start_time} → ${session.end_time ?? '（未结束）'}`} />
      <div className="text-[11px] text-gray-400">动作顺序（exercises 数组序 = 执行顺序）与逐组时间戳：</div>
      <div className="space-y-1.5">
        {session.exercises.map((ex, exIdx) => (
          <div key={exIdx} className="rounded-lg bg-gray-950/70 border border-white/5 p-2">
            <div className="text-[12px] text-gray-200 font-semibold mb-1">{exIdx + 1}. {ex.name}</div>
            <div className="space-y-0.5">
              {ex.sets.map((s, setIdx) => {
                const note = noteOf(exIdx, setIdx);
                return (
                  <div key={setIdx} className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-mono text-gray-400">#{s.index}</span>
                    <span className="font-mono text-gray-300">{s.timestamp}</span>
                    {note && (
                      <span className={`font-mono text-[10px] px-1 py-px rounded border ${TS_SOURCE_STYLE[note.timestamp_source]}`}>
                        {TS_SOURCE_LABEL[note.timestamp_source]}
                      </span>
                    )}
                  </div>
                );
              })}
              {ex.sets.length === 0 && <span className="text-[11px] text-gray-600">（无组）</span>}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
};

/** ③ 卡卡关系：快照来源 + exercise_id 引用完整性判定 */
const RelationSection: React.FC<{ detail: AgentPayloadSnapshotDetail }> = ({ detail }) => {
  const session = asDeliverySession(detail.payload);
  const refs = session?.exercises.map(e => e.exercise_id) ?? [];
  const applied = detail.validation.reference_check === 'applied';
  return (
    <Section title="卡卡关系（引用与合并来源）" index="③" data-testid="section-relation">
      <Field label="快照来源" value="sessions.raw_json（sync push 写链）→ #97 归一+硬校验" />
      <Field label="合并去重" value="load_history：sessions 表权威 + write_session 记忆补位（本快照 = 权威源交付候选）" />
      <Field
        label="引用检查"
        value={applied ? '已检（动作库全集）' : '未检（快照时动作库全集不可读）'}
        danger={!applied}
      />
      {refs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-gray-400">动作库引用（exerciseId → exercises.id）：</div>
          {refs.map((id, i) => (
            <Field
              key={`${id}-${i}`}
              label={`ex[${i}]`}
              value={id}
              danger={detail.validation.code === 'reference'}
            />
          ))}
        </div>
      )}
    </Section>
  );
};

/** ④ 感受序列：feel 跨组曲线（0-100 原值）+ feel_note 语义补充列表 */
const FeelSection: React.FC<{ session: AgentDeliverySession }> = ({ session }) => {
  const points = session.exercises.flatMap((ex, exIdx) =>
    (ex.sets ?? [])
      .filter(s => s.feel !== undefined)
      .map(s => ({
        label: `${exIdx + 1}·${ex.name}#${s.index}`,
        feel: s.feel as number,
        note: s.feel_note,
      })),
  );
  const notes = points.filter(p => p.note);
  return (
    <Section title="感受序列" index="④" data-testid="section-feel">
      {points.length === 0 ? (
        <div className="text-[12px] text-gray-500">本次无 feel 数据（缺席 ≠ 零表现：组后弹窗未采集或旧数据）</div>
      ) : (
        <>
          {/* feel 曲线：0-100 原值折线（SVG 内联，无依赖） */}
          <svg
            viewBox={`0 0 ${Math.max(points.length * 44, 120)} 64`}
            className="w-full h-16"
            data-testid="feel-curve"
            role="img"
            aria-label="feel sequence"
          >
            {points.map((p, i) => {
              const x = i * 44 + 22;
              const y = 60 - (p.feel / 100) * 56;
              return (
                <g key={i}>
                  {i > 0 && (
                    <line
                      x1={x - 44} y1={60 - (points[i - 1].feel / 100) * 56} x2={x} y2={y}
                      stroke="rgb(56 189 248)" strokeWidth="1.5"
                    />
                  )}
                  <circle cx={x} cy={y} r="3" fill="rgb(56 189 248)" />
                  <text x={x} y={y - 7} textAnchor="middle" fontSize="9" fill="rgb(148 163 184)">{p.feel}</text>
                </g>
              );
            })}
            <line x1="0" y1="60" x2={Math.max(points.length * 44, 120)} y2="60" stroke="rgb(255 255 255 / 0.1)" />
          </svg>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {points.map((p, i) => (
              <span key={i} className="text-[10px] font-mono text-gray-500">{p.label}={p.feel}</span>
            ))}
          </div>
          {notes.length > 0 && (
            <div className="space-y-1 mt-1">
              <div className="text-[11px] text-gray-400">feel_note 语义补充：</div>
              {notes.map((p, i) => (
                <div key={i} className="rounded bg-gray-950/70 border border-white/5 p-1.5 text-[12px] text-gray-300">
                  <span className="text-[10px] font-mono text-gray-500">{p.label}：</span>{p.note}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
};

/** ⑤ 预处理结果：逐组 timestamp 来源 + status 归一轨迹（载荷之外的推导标注） */
const PreprocessSection: React.FC<{ preprocess: AgentSetPreprocessNote[]; session: AgentDeliverySession }> = ({
  preprocess,
  session,
}) => (
  <Section title="预处理结果（归一轨迹）" index="⑤" data-testid="section-preprocess">
    <div className="text-[11px] text-gray-400">
      normalize 规则：timestamp 缺失按 <span className="font-mono text-amber-300">startTime + (index+1)×60s</span> 推算锚点（导出间隔非测量值）；status UPPERCASE/布尔 → 契约小写枚举；非契约字段透传保留。
    </div>
    {preprocess.length === 0 ? (
      <div className="text-[12px] text-rose-300">无预处理标注（unnormalizable 行未产生归一轨迹）</div>
    ) : (
      <div className="space-y-0.5">
        {preprocess.map((n, i) => {
          const exName = session.exercises[n.exercise_index]?.name ?? `ex[${n.exercise_index}]`;
          return (
            <div key={i} className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="font-mono text-gray-400 min-w-[110px]">{exName} #{n.set_index}</span>
              <span className={`font-mono text-[10px] px-1 py-px rounded border ${TS_SOURCE_STYLE[n.timestamp_source]}`}>
                {TS_SOURCE_LABEL[n.timestamp_source]}
              </span>
              <span className="font-mono text-gray-500">
                status: {n.status_original === null ? '∅' : JSON.stringify(n.status_original)} → {n.status_normalized}
              </span>
            </div>
          );
        })}
      </div>
    )}
  </Section>
);

// ============================================================================
// 详情页
// ============================================================================

const PayloadDetail: React.FC<{
  sessionId: string;
  onBack: () => void;
  onReload: () => void;
}> = ({ sessionId, onBack, onReload }) => {
  const [detail, setDetail] = useState<AgentPayloadSnapshotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    fetchSnapshotDetail(sessionId)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [sessionId]);

  if (error) {
    return (
      <div className="p-3 space-y-3">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-200" data-testid="payload-back">← 返回列表</button>
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-300 break-all" data-testid="payload-error">
          快照详情拉取失败（无兜底，原文展示）：{error}
        </div>
      </div>
    );
  }
  if (!detail) {
    return <div className="p-3 text-[12px] text-gray-500" data-testid="payload-loading">加载中…</div>;
  }

  const session = detail.validation.code === 'unnormalizable' ? null : asDeliverySession(detail.payload);

  return (
    <div className="p-3 space-y-3" data-testid="payload-detail">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-200" data-testid="payload-back">← 返回列表</button>
        <button onClick={onReload} className="ml-auto text-[10px] font-mono text-gray-500 hover:text-gray-300">重新拉取</button>
      </div>

      {/* 校验结果 banner：过/拒 + 明细（拒付红色标注 + 原因） */}
      <div
        className={`rounded-xl border p-3 space-y-1.5 ${
          detail.validation_passed
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-rose-500/40 bg-rose-500/10'
        }`}
        data-testid="payload-validation"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-bold text-gray-100">本次交付校验</span>
          <ValidationBadge passed={detail.validation_passed} code={detail.validation.code} />
          <span className="ml-auto text-[10px] font-mono text-gray-500">{fmtTime(detail.updated_at)}</span>
        </div>
        <Field label="code" value={detail.validation.code} danger={!detail.validation_passed} />
        {detail.validation.reason && (
          <Field label="原因" value={detail.validation.reason} danger />
        )}
        <Field label="引用检查" value={detail.validation.reference_check === 'applied' ? '已检（动作库全集）' : '未检（快照时库全集不可读）'} danger={detail.validation.reference_check !== 'applied'} />
        <Field label="校验时刻" value={detail.validation.checked_at} />
        <Field label="快照首冻" value={fmtTime(detail.snapshotted_at)} />
      </div>

      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-3 space-y-1.5" data-testid="payload-meta">
        <div className="text-[13px] font-bold text-gray-100">{detail.title ?? '训练快照'}</div>
        <Field label="session_id" value={detail.session_id} />
        <Field label="窗口" value={`${fmtTime(detail.start_time)} → ${fmtTime(detail.end_time)}`} />
        <Field label="动作数" value={detail.exercise_count} />
      </div>

      {session ? (
        <>
          <CardDataSection session={session} />
          <TimelineSection session={session} preprocess={detail.preprocess} />
          <RelationSection detail={detail} />
          <FeelSection session={session} />
          <PreprocessSection preprocess={detail.preprocess} session={session} />
        </>
      ) : (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-300 space-y-1" data-testid="payload-unnormalizable-note">
          <div>载荷连归一都未通过（unnormalizable）——无结构化分区，payload 按交付时点原样冻结于下方 JSON 视图。</div>
          <div className="text-rose-200 font-mono text-[11px]">{detail.validation.reason}</div>
        </div>
      )}

      {/* 原始 payload JSON 视图（可展开复制） */}
      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-3 space-y-2" data-testid="payload-raw">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJson(v => !v)}
            className="text-[12px] font-semibold text-sky-300 hover:text-sky-200"
            data-testid="payload-json-toggle"
          >
            {showJson ? '▾' : '▸'} 原始 payload JSON
          </button>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(JSON.stringify(detail.payload, null, 2));
            }}
            className="ml-auto text-[10px] font-mono text-gray-400 hover:text-gray-200 border border-white/10 rounded px-1.5 py-0.5"
            data-testid="payload-json-copy"
          >
            复制
          </button>
        </div>
        {showJson && (
          <pre className="text-[10px] leading-relaxed font-mono text-gray-300 bg-gray-950 rounded-lg p-2 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
            {JSON.stringify(detail.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 列表页
// ============================================================================

const PAGE_SIZE = 20;

export const PayloadAuditPanel: React.FC = () => {
  const [rows, setRows] = useState<AgentPayloadSnapshotListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (pageOffset: number) => {
    setError(null);
    try {
      const res = await fetchSnapshotList(PAGE_SIZE, pageOffset);
      setRows(res.snapshots);
      setTotal(res.total);
      setOffset(pageOffset);
    } catch (e) {
      setRows(null);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(0); }, [load]);

  if (selectedId) {
    return (
      <PayloadDetail
        sessionId={selectedId}
        onBack={() => setSelectedId(null)}
        onReload={() => { void load(offset); }}
      />
    );
  }

  return (
    <div className="p-3 space-y-3" data-testid="payload-list">
      <div className="text-[11px] text-gray-500 leading-relaxed">
        训练后审计：每次训练一条交付快照（ingestion 链冻结 normalize payload + 硬校验结果）。拒付行红色标注，点开可见失败明细。
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-300 break-all" data-testid="payload-error">
          快照列表拉取失败（无兜底，原文展示）：{error}
        </div>
      )}

      {rows && rows.length === 0 && !error && (
        <div className="rounded-xl border border-white/10 bg-gray-900/60 p-4 text-[12px] text-gray-400" data-testid="payload-empty">
          该用户暂无交付快照——完成一次训练（本地落账 → sync push）后自动生成。
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map(row => (
            <button
              key={row.session_id}
              onClick={() => setSelectedId(row.session_id)}
              className="w-full text-left rounded-xl border border-white/10 bg-gray-900/60 hover:bg-gray-900 p-2.5 space-y-1 transition-colors"
              data-testid={`payload-row-${row.session_id}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-100">{fmtTime(row.start_time)}</span>
                <ValidationBadge passed={row.validation_passed} code={row.validation_code} />
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 flex-wrap">
                <span>{row.title ?? '（无标题）'}</span>
                <span>· {row.exercise_count} 动作</span>
                <span className="truncate max-w-[140px]">{row.session_id}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {rows && total > PAGE_SIZE && (
        <div className="flex items-center gap-2 justify-center pt-1" data-testid="payload-pager">
          <button
            disabled={offset === 0}
            onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
            className="text-[11px] font-mono px-2 py-1 rounded border border-white/10 text-gray-300 disabled:text-gray-600 disabled:border-white/5"
            data-testid="payload-prev"
          >
            ← 上一页
          </button>
          <span className="text-[10px] font-mono text-gray-500" data-testid="payload-page-info">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => void load(offset + PAGE_SIZE)}
            className="text-[11px] font-mono px-2 py-1 rounded border border-white/10 text-gray-300 disabled:text-gray-600 disabled:border-white/5"
            data-testid="payload-next"
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
};
