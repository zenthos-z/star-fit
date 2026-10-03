import React, { useRef, useState } from 'react';
import type { SurveyQuestion, SurveyQuestionOption } from 'shared/contracts';
import { ChatCardHeader } from './ChatCardHeader';
import { ChatCardShell, ChatPrimaryButton } from './ChatCardShell';

interface SurveyCardProps {
  uiHint: {
    type: 'survey_card';
    data: {
      title?: string;
      subtitle?: string;
      sessionId?: string;
      /** 卡用途（#114 B5a 契约）：profile_intake / workout_feedback / plan_gap */
      purpose?: string;
      questions?: readonly SurveyQuestion[];
      // Legacy single question support
      question?: string;
      options?: Array<{ label: string; value: string }>;
      multiSelect?: boolean;
    };
    /** 提交状态（持久化在 ChatMessage.uiHint 上，切话题/重启不回弹，2026-09-14） */
    submitted?: SurveySubmitRecord;
  };
  onConfirm?: (value: string | string[]) => void;
}

/** 问卷提交记录：固化已提交状态，随 thread 持久化 */
export interface SurveySubmitRecord {
  submittedAt: number;  // epoch ms
  /** 已提交的回答摘要（questionId/childKey → 选项 label 或原文；多选题为 string[]），用于只读回显 */
  answers: Record<string, string | string[]>;
}

/**
 * SurveyCard (SURVEY_CARD) - 问卷多态渲染（issue #114 B5b）
 *
 * 题源 = shared/contracts/survey.ts 共享题库（PROFILE_INTAKE_QUESTIONS），
 * 契约新字段全 optional——旧卡（无 section/children/condition/purpose）零
 * 新依赖、按现状渲染，已固化 submitted 卡不受影响。
 * 新增渲染能力（spec §2.5/§7，全部按「有则显示」门控）：
 * - children 二级菜单：单选父选项（带 children）选中后展开多选 chips，
 *   父值写 answers[id]、勾选结果写 answers[childKey]；切换父选项清空
 *   children 勾选（有已勾项时二次确认「切换场地将清空已选器材」）；
 *   children 组首「全选」chip（全勾/全取消 toggle）。
 * - textarea：min-height 96px + maxLength 计数器「n/500」。
 * - number：inputmode decimal + 单位 chip 右置 + min/max 越界行内红字。
 * - condition 条件显示：不满足则不渲染且不参与必答闸门。
 * - section 分组标题 / hint 题干辅助 / injuries「无」互斥（value==='none'
 *   渲染层硬规则，不进契约）。
 * - 提交闸门：必答未满禁用，按钮下「还有 N 项未完成」（N 实时）。
 * - 已提交回显：题干 + 答案 chip 只读列表（多选逗号连接）。
 */
export const SurveyCard: React.FC<SurveyCardProps> = ({ uiHint, onConfirm }) => {
  // answers 存储字符串（单选/文本）或字符串数组（多选/children 勾选）
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [textInputs, setTextInputs] = useState<Record<string, string>>({});
  // 场地切换二次确认（spec §2.3）：有已勾 children 时切换需确认
  const [pendingVenueSwitch, setPendingVenueSwitch] = useState<{
    questionId: string; childKey: string; nextValue: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // [FIX] Use ref to prevent race conditions with state updates
  const isUploadingRef = useRef(false);

  const submitted = uiHint?.submitted;

  // Support both new multi-question format and legacy single-question format
  const data = uiHint?.data || {};
  const questions = data.questions || [];

  // Legacy support: if no questions array but has question/options, convert to new format
  // Ensure displayQuestions is always an array to avoid "Cannot read properties of undefined"
  const displayQuestions: SurveyQuestion[] = (questions && questions.length > 0)
    ? [...questions]
    : (data.question ? [{
        id: 'legacy_question',
        question: data.question,
        required: true,
        options: data.options || []
      }] : []);

  const title = data.title || '补充训练信息';
  const subtitle = data.subtitle;

  /** condition 条件显示：被引用题当前选中值 ∈ equals 才渲染 */
  const isConditionMet = (q: SurveyQuestion): boolean => {
    if (!q.condition) return true;
    const ref = answers[q.condition.questionId];
    const refValue = Array.isArray(ref) ? ref[0] : ref;
    const expected = Array.isArray(q.condition.equals) ? q.condition.equals : [q.condition.equals];
    return refValue !== undefined && expected.includes(refValue);
  };

  /** 可见题 = 通过 condition 的题（不可见题不参与必答闸门与提交） */
  const visibleQuestions = displayQuestions.filter(isConditionMet);

  /** 文本题当前值（textInputs 与 answers 双写，读任一） */
  const valueOf = (id: string): string | string[] | undefined =>
    textInputs[id] ?? answers[id];

  /** number 越界校验：返回行内红字文案（spec §7 提示格式「请输入 30-250 之间的数值」） */
  const numberError = (q: SurveyQuestion): string | null => {
    if (q.inputType !== 'number' || (q.min === undefined && q.max === undefined)) return null;
    const raw = valueOf(q.id);
    if (raw === undefined || String(raw).trim() === '') return null; // 空值交必答闸门
    const n = Number(raw);
    if (Number.isNaN(n)) return '请输入数值';
    if ((q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) {
      return `请输入 ${q.min}-${q.max} 之间的数值`;
    }
    return null;
  };

  /** 必答未完成计数（visible 题内：required 未答 + children 联动未勾） */
  const missingRequiredCount = visibleQuestions.filter((q) => {
    if (!q.required) return false;
    const v = valueOf(q.id);
    if (Array.isArray(v)) return v.length === 0;
    if (v === undefined || String(v).trim() === '') return true;
    return numberError(q) !== null; // 越界值不算已答
  }).length;

  /** children 联动：选中带 children 的父选项后至少勾 1 项（spec §2.5 语义 2） */
  const missingChildrenCount = visibleQuestions.filter((q) => {
    if (!q.childKey) return false;
    const parentValue = answers[q.id];
    if (typeof parentValue !== 'string' || parentValue === '') return false;
    const parentOpt = q.options?.find((o) => o.value === parentValue);
    if (!parentOpt?.children?.length) return false;
    const kids = answers[q.childKey];
    return !(Array.isArray(kids) && kids.length > 0);
  }).length;

  const incompleteCount = missingRequiredCount + missingChildrenCount;

  // ── 已提交只读态（状态固化：随 thread 持久化，重开对话不回弹为可填问卷）──
  if (submitted) {
    // 只读回显（spec §2.6/§7）：题干 + 答案 chip，多选逗号连接；无「重新填写」入口
    const labelForValue = (q: SurveyQuestion, value: string): string => {
      for (const o of q.options ?? []) {
        if (o.value === value) return o.label;
        const child = o.children?.find((c) => c.value === value);
        if (child) return child.label;
      }
      return value;
    };
    const rows: Array<{ q: SurveyQuestion; main?: string; child?: string }> = [];
    for (const q of displayQuestions) {
      const v = submitted.answers[q.id];
      const childV = q.childKey ? submitted.answers[q.childKey] : undefined;
      const has = (x: unknown) => x !== undefined && (Array.isArray(x) ? x.length > 0 : String(x) !== '');
      if (!has(v) && !has(childV)) continue;
      rows.push({
        q,
        main: has(v)
          ? (Array.isArray(v) ? v.map((x) => labelForValue(q, x)).join('，') : labelForValue(q, String(v)))
          : undefined,
        child: has(childV) && Array.isArray(childV)
          ? childV.map((x) => labelForValue(q, x)).join('，')
          : undefined,
      });
    }

    return (
      <ChatCardShell testId="survey-card-submitted">
        <ChatCardHeader title={title} subtitle="已提交" />
        {/* 右上日期（spec §7：同现状 toLocaleDateString zh-CN 格式） */}
        <div className="px-5 pt-1 flex justify-end">
          <span className="text-xs text-gray-400" data-testid="survey-submitted-date">
            {new Date(submitted.submittedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
          </span>
        </div>
        {rows.length > 0 ? (
          <div className="px-5 py-4 space-y-3" data-testid="survey-submitted-list">
            {rows.map(({ q, main, child }) => (
              <div key={q.id}>
                <p className="text-[13px] font-medium text-gray-500">{q.question}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {main !== undefined && (
                    <span className="px-3 py-1 rounded-full bg-gray-100 text-[13px] font-medium text-gray-700">
                      {main}
                    </span>
                  )}
                  {child !== undefined && (
                    <span
                      data-testid={`survey-submitted-child-${q.childKey}`}
                      className="px-3 py-1 rounded-full bg-blue-50 text-[13px] font-medium text-gray-700"
                    >
                      {child}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 pb-4 flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <p className="text-[15px] font-semibold text-gray-900 leading-snug flex-1">
              问卷已提交
            </p>
          </div>
        )}
      </ChatCardShell>
    );
  }

  /** 多选勾选切换（checkbox 与 children chips 共用） */
  const toggleMulti = (key: string, value: string) => {
    setAnswers((prev) => {
      const current = prev[key];
      const list = Array.isArray(current) ? current : [];
      return {
        ...prev,
        [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      };
    });
  };

  /** checkbox「无」互斥（渲染层硬规则：value==='none' 触发，spec §2.6） */
  const toggleInjuryMulti = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      const list = Array.isArray(current) ? current : [];
      let next: string[];
      if (value === 'none') {
        // 点「无」：清空其他，仅保留/取消「无」
        next = list.includes('none') ? [] : ['none'];
      } else {
        // 点部位：自动取消「无」
        next = list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list.filter((v) => v !== 'none'), value];
      }
      return { ...prev, [questionId]: next };
    });
  };

  /** 单选（select）父选项点击：带 children 且已有勾选 → 先出确认，否则直切并清空 children */
  const handleParentSelect = (q: SurveyQuestion, opt: SurveyQuestionOption) => {
    const currentValue = answers[q.id];
    if (currentValue === opt.value) return; // 重复点击不动作
    if (q.childKey && opt.children?.length) {
      const kids = answers[q.childKey];
      if (Array.isArray(kids) && kids.length > 0) {
        setPendingVenueSwitch({ questionId: q.id, childKey: q.childKey, nextValue: opt.value });
        return;
      }
    }
    setPendingVenueSwitch(null);
    setAnswers((prev) => {
      const next = { ...prev, [q.id]: opt.value };
      if (q.childKey) delete next[q.childKey]; // 切换父选项清空前一 children 勾选（spec §2.5 语义 3）
      return next;
    });
  };

  const confirmVenueSwitch = () => {
    if (!pendingVenueSwitch) return;
    const { questionId, childKey, nextValue } = pendingVenueSwitch;
    setPendingVenueSwitch(null);
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: nextValue };
      delete next[childKey];
      return next;
    });
  };

  /** children「全选」toggle：全勾 ↔ 全取消（spec §2.3 组首快捷 chip） */
  const toggleSelectAll = (childKey: string, children: SurveyQuestionOption[]) => {
    setAnswers((prev) => {
      const current = prev[childKey];
      const list = Array.isArray(current) ? current : [];
      const allSelected = children.every((c) => list.includes(c.value));
      return { ...prev, [childKey]: allSelected ? [] : children.map((c) => c.value) };
    });
  };

  /** 文本/数字输入变化 */
  const handleTextInputChange = (questionId: string, value: string) => {
    setTextInputs((prev) => ({ ...prev, [questionId]: value }));
    // 同时更新到 answers，便于统一处理
    setAnswers((prev: Record<string, string | string[]>) => ({ ...prev, [questionId]: value }));
  };

  const handleUpload = () => {
    // [FIX] Check ref first to prevent race conditions
    if (isUploadingRef.current || incompleteCount > 0) {
      return;
    }

    isUploadingRef.current = true;
    setIsUploading(true);

    // 只收可见题的答案（condition 隐藏题不提交），空值剔除
    const includeIds = new Set<string>();
    visibleQuestions.forEach((q) => {
      includeIds.add(q.id);
      if (q.childKey) includeIds.add(q.childKey);
    });
    const responses: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...answers, ...textInputs })) {
      if (!includeIds.has(k)) continue;
      if (Array.isArray(v)) {
        if (v.length > 0) responses[k] = v;
      } else if (v !== undefined && String(v).trim() !== '') {
        responses[k] = v;
      }
    }

    // Build upload data
    const uploadData = JSON.stringify({
      sessionId: data.sessionId,
      responses,
      timestamp: Date.now()
    });

    // Use the special upload format that handleChatSubmit will recognize
    onConfirm?.(`[UPLOAD_SURVEY_DATA]:${uploadData}`);

    // [FIX] Reset flag after a reasonable delay (assuming API response within 10 seconds)
    setTimeout(() => {
      isUploadingRef.current = false;
      setIsUploading(false);
    }, 10000);
  };

  // Legacy mode: single question, direct confirm
  const isLegacyMode = questions.length === 0 && data.question;

  if (isLegacyMode) {
    // Legacy single-question mode
    const question = data.question || '加载中...';
    const options = data.options || [];

    return (
      <ChatCardShell>
        <ChatCardHeader title="练后调研" />

        <div className="p-5">
          <h4 className="text-[15px] font-medium text-gray-900 leading-relaxed mb-6">
            {question}
          </h4>

          <div className="space-y-2.5">
            {options.map((opt, idx: number) => (
              <button
                key={opt?.value || idx}
                onClick={() => onConfirm?.(opt?.value)}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-left text-[15px] font-medium text-gray-800 hover:border-blue-200 hover:bg-blue-50/50 transition-all active:scale-95 flex justify-between items-center"
              >
                {opt?.label || '未知选项'}
                <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </ChatCardShell>
    );
  }

  /** 提交按钮文案按 purpose 分流（spec §2.6）；无 purpose（旧卡/练后）保持现状 */
  const submitLabel = data.purpose === 'profile_intake'
    ? '完成，生成我的计划'
    : data.purpose === 'plan_gap'
      ? '提交'
      : '上传补充信息';

  /** section 分组行（组标题 + 组间距 16px：组间 pt-4，spec §2.6/§7） */
  const rows = visibleQuestions.map((q, idx) => {
    const showSection = q.section !== undefined && q.section !== visibleQuestions[idx - 1]?.section;
    return { q, idx, showSection };
  });

  return (
    <ChatCardShell testId="survey-card">
      <ChatCardHeader
        title={title}
        subtitle={subtitle}
      />

      <div className="p-5 space-y-4" data-testid="survey-questions">
        {rows.map(({ q, idx, showSection }) => {
          // 判断是否有选项：有 options 显示 chips，没有显示输入框
          const hasOptions = Array.isArray(q?.options) && q.options.length > 0;

          // children 面板：父题设 childKey 且选中的父选项带 children（spec：一级未选中不渲染）
          const selectedParent = (q.childKey && typeof answers[q.id] === 'string')
            ? q.options?.find((o) => o.value === answers[q.id])
            : undefined;
          const childOptions = selectedParent?.children ?? [];
          const showChildren = !!q.childKey && childOptions.length > 0;
          const kidSelection = (q.childKey && Array.isArray(answers[q.childKey])) ? answers[q.childKey] as string[] : [];
          const allChildrenSelected = childOptions.length > 0 && childOptions.every((c) => kidSelection.includes(c.value));

          // 文本输入当前值与错误
          const textValue = String(textInputs[q.id] ?? (typeof answers[q.id] === 'string' ? answers[q.id] : '') ?? '');
          const numError = numberError(q);

          return (
            <React.Fragment key={q?.id || idx}>
              {showSection && (
                <p className="pt-4 first:pt-0 text-[13px] font-semibold text-gray-400" data-testid={`survey-section-${q.id}`}>
                  {q.section}
                </p>
              )}
              <div className="space-y-3" data-testid={`survey-question-${q?.id}`}>
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-semibold">{idx + 1}.</span>
                  <p className="font-medium text-gray-900 flex-1">{q?.question || '未知问题'}</p>
                  {q?.required && <span className="text-red-500 text-xs">*</span>}
                </div>

                {/* 题干辅助说明（spec §7：13px text-gray-500，置于题干下一行） */}
                {q?.hint && (
                  <p className="pl-6 text-[13px] text-gray-500" data-testid={`survey-hint-${q.id}`}>{q.hint}</p>
                )}

                {/* 有选项：显示选项 chips */}
                {hasOptions && (
                  <div className="flex flex-wrap gap-2 pl-6">
                    {q.options!.map((opt, optIdx: number) => {
                      const isMultiSelect = q?.inputType === 'checkbox';
                      const value = answers[q.id];
                      const isSelected = Array.isArray(value)
                        ? value.includes(opt.value)
                        : value === opt.value;

                      return (
                        <button
                          key={opt.value || optIdx}
                          data-testid={`survey-option-${q?.id}-${opt.value}`}
                          onClick={() => {
                            if (isMultiSelect) {
                              // checkbox：「无」与其他部位互斥（渲染层硬规则）
                              toggleInjuryMulti(q.id, opt.value);
                            } else {
                              handleParentSelect(q, opt);
                            }
                          }}
                          className={`
                            px-4 py-3 rounded-full text-[15px] font-medium transition-all active:scale-95
                            ${isSelected
                              ? 'bg-star-accent text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                          `}
                        >
                          <span className="flex items-center gap-2">
                            {isMultiSelect && (
                              <svg className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={isSelected ? "M5 13l4 4L19 7" : "M9 5l7 7-7 7"} />
                              </svg>
                            )}
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 二级菜单（children）：一级选中后 200ms ease-out 高度过渡展开 */}
                {showChildren && q.childKey && (
                  <div
                    data-testid={`survey-children-${q.id}`}
                    className={`pl-6 grid transition-[grid-template-rows] duration-200 ease-out ${childOptions.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                  >
                    <div className="overflow-hidden">
                      <div className="pt-3 flex flex-wrap gap-2">
                        {/* 「全选」快捷 chip：全勾 ↔ 全取消 */}
                        <button
                          data-testid={`survey-select-all-${q.id}`}
                          onClick={() => toggleSelectAll(q.childKey!, childOptions)}
                          className={`
                            px-4 py-3 rounded-full text-[15px] font-medium transition-all active:scale-95
                            ${allChildrenSelected
                              ? 'bg-star-accent text-white'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}
                          `}
                        >
                          全选
                        </button>
                        {childOptions.map((child) => {
                          const isSelected = kidSelection.includes(child.value);
                          return (
                            <button
                              key={child.value}
                              data-testid={`survey-option-${q.childKey}-${child.value}`}
                              onClick={() => toggleMulti(q.childKey!, child.value)}
                              className={`
                                px-4 py-3 rounded-full text-[15px] font-medium transition-all active:scale-95
                                ${isSelected
                                  ? 'bg-star-accent text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                              `}
                            >
                              <span className="flex items-center gap-2">
                                <svg className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={isSelected ? "M5 13l4 4L19 7" : "M9 5l7 7-7 7"} />
                                </svg>
                                {child.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 场地切换二次确认（spec §2.3：切场地清空已选器材需确认） */}
                {pendingVenueSwitch?.questionId === q.id && (
                  <div
                    data-testid={`survey-venue-confirm-${q.id}`}
                    className="ml-6 flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-50 text-[13px] text-gray-700"
                  >
                    <span className="flex-1">切换场地将清空已选器材</span>
                    <button
                      data-testid={`survey-venue-confirm-ok-${q.id}`}
                      onClick={confirmVenueSwitch}
                      className="px-3 py-1.5 rounded-full bg-star-accent text-white text-[13px] font-medium active:scale-95"
                    >
                      确认切换
                    </button>
                    <button
                      data-testid={`survey-venue-confirm-cancel-${q.id}`}
                      onClick={() => setPendingVenueSwitch(null)}
                      className="px-3 py-1.5 rounded-full bg-white text-gray-600 text-[13px] font-medium border border-gray-200 active:scale-95"
                    >
                      取消
                    </button>
                  </div>
                )}

                {/* 没有选项：显示输入框（textarea 单独渲染，#114 缺口 6） */}
                {!hasOptions && (
                  <div className="pl-6">
                    {q?.inputType === 'textarea' ? (
                      <>
                        <textarea
                          data-testid={`survey-input-${q?.id}`}
                          value={textValue}
                          maxLength={q?.maxLength}
                          onChange={(e) => handleTextInputChange(q.id, e.target.value)}
                          placeholder={q?.placeholder || '请输入...'}
                          className={`
                            w-full min-h-[96px] px-4 py-3 rounded-2xl border-2 text-sm font-medium
                            transition-all outline-none shadow-sm resize-none
                            ${textValue ? 'border-star-accent bg-blue-50/40' : 'border-gray-200 bg-gray-50 focus:border-star-accent focus:bg-white'}
                          `}
                        />
                        {/* 字数计数器：右下 12px text-gray-400（spec §7） */}
                        {q?.maxLength !== undefined && (
                          <p className="text-right text-[12px] text-gray-400 mt-1" data-testid={`survey-counter-${q.id}`}>
                            {textValue.length}/{q.maxLength}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode={q?.inputType === 'number' ? 'decimal' : undefined}
                            data-testid={`survey-input-${q?.id}`}
                            value={textValue}
                            onChange={(e) => handleTextInputChange(q.id, e.target.value)}
                            placeholder={q?.placeholder || '请输入...'}
                            className={`
                              w-full px-4 py-3 rounded-2xl border-2 text-sm font-medium
                              transition-all outline-none shadow-sm
                              ${q?.unit ? 'pr-14' : ''}
                              ${textValue
                                ? 'border-star-accent bg-blue-50/40'
                                : 'border-gray-200 bg-gray-50 focus:border-star-accent focus:bg-white'}
                            `}
                          />
                          {/* 单位后缀 chip 右置（spec §7） */}
                          {q?.unit && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                              {q.unit}
                            </span>
                          )}
                        </div>
                        {/* number 越界行内红字提示（spec §7） */}
                        {numError && (
                          <p className="text-xs text-red-500 mt-1.5" data-testid={`survey-error-${q.id}`}>
                            {numError}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="p-5 pt-0">
        <ChatPrimaryButton
          className="w-full"
          testId="survey-submit"
          onClick={handleUpload}
          disabled={incompleteCount > 0 || isUploading}
        >
          {isUploading ? '上传中...' : submitLabel}
        </ChatPrimaryButton>
        {incompleteCount > 0 && (
          <p className="text-xs text-gray-400 text-center mt-2" data-testid="survey-incomplete-hint">
            还有 {incompleteCount} 项未完成
          </p>
        )}
      </div>
    </ChatCardShell>
  );
};
