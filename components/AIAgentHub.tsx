import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, CalendarDays, ChevronRight, Send } from 'lucide-react';
import { loadDayPlans, loadNextPlan } from '../storage';

interface AIAgentHubProps {
  threadCount: number;
  lastChatTime: string | null;
  onStartChat: () => void;
  onOpenHistory: () => void;
  /** 快捷插卡：把某天计划覆盖到"开始运动"页 */
  onApplyPlan: (plan: any[]) => void;
}

const DAY_MS = 86400000;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * AI Agent 入口页（tab 2 的二级菜单）。
 * 视觉规范（对齐苹果运动 App）：单色系 = 蓝，深浅分层表达优先级——
 *   主操作 = 深蓝实底；次级 = 浅蓝底/白底；辅助文字 = 中性灰。
 * 布局：对话区（上，主操作）→ 7 天计划墙（大面积，核心内容）。
 */
export const AIAgentHub: React.FC<AIAgentHubProps> = ({
  threadCount,
  lastChatTime,
  onStartChat,
  onOpenHistory,
  onApplyPlan,
}) => {
  const [dayPlans, setDayPlans] = useState<Record<string, any[] | null>>({});

  // 7 天窗口：昨天 ~ 6 天后
  useEffect(() => {
    const load = async () => {
      const dates: string[] = [];
      const now = Date.now();
      for (let i = -1; i <= 6; i++) dates.push(fmtDate(new Date(now + i * DAY_MS)));
      const byDay = await loadDayPlans(dates);
      // 兼容旧数据：旧 nextPlan = 明天的计划
      if (!byDay[dates[2]]) {
        const legacy = await loadNextPlan();
        if (legacy && legacy.length > 0) byDay[dates[2]] = legacy;
      }
      setDayPlans(byDay);
    };
    load();
    window.addEventListener('starfit:dayplans-changed', load);
    return () => window.removeEventListener('starfit:dayplans-changed', load);
  }, []);

  const days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.now() + (i - 1) * DAY_MS);
    const key = fmtDate(d);
    const plan = dayPlans[key] || null;
    return { date: d, key, plan, isToday: i === 1 };
  });

  const applyPlan = (plan: any[]) => {
    if (!plan || plan.length === 0) return;
    onApplyPlan(plan);
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#FAFAFA] overflow-y-auto"
      style={{ paddingTop: 'calc(var(--safe-top) + 24px)', paddingBottom: 120 }}
    >
      <div className="px-5">
        {/* Large Title */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="flex items-end justify-between"
        >
          <div>
            <h1 className="text-[34px] font-bold text-gray-900 tracking-tight">AI 教练</h1>
            <p className="text-[15px] text-gray-500 mt-1">你的私人训练顾问</p>
          </div>
          {/* 历史对话：紧凑入口，与对话主按钮同屏贴近 */}
          <button
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#E8F1FF] active:scale-95 transition-transform mb-1"
          >
            <MessageSquare className="w-4 h-4 text-[#0A84FF]" strokeWidth={2.2} />
            <span className="text-[14px] font-medium text-[#0A84FF]">历史{threadCount > 0 ? ` · ${threadCount}` : ''}</span>
          </button>
        </motion.div>

        {/* 主入口：开始对话 */}
        <motion.button
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut', delay: 0.05 }}
          onClick={onStartChat}
          className="w-full mt-5 rounded-[24px] bg-[#0A84FF] shadow-lg active:scale-[0.98] transition-transform text-left relative overflow-hidden"
          style={{ minHeight: 108 }}
        >
          <div className="px-6 py-5 flex items-center gap-4 relative z-10">
            <div className="w-12 h-12 rounded-[14px] bg-white/20 flex items-center justify-center shrink-0">
              <MessageSquare className="w-6 h-6 text-white" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[21px] font-bold text-white">开始对话</div>
              <div className="text-[13px] text-white/75 mt-0.5 truncate">
                {lastChatTime ? `继续上次的对话 · ${lastChatTime}` : '和 AI 教练聊聊你的训练'}
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-white/60 shrink-0" strokeWidth={2.5} />
          </div>
        </motion.button>

        {/* 7 天计划墙（前 1 天 + 今天 + 后 6 天） */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut', delay: 0.1 }}
          className="mt-6"
        >
          <div className="flex items-center gap-2 px-1 mb-3">
            <CalendarDays className="w-[18px] h-[18px] text-[#0A84FF]" strokeWidth={2.2} />
            <span className="text-[17px] font-semibold text-gray-900">训练计划</span>
            <span className="text-[13px] text-gray-400 ml-auto">前 1 天 · 后 6 天</span>
          </div>

          <div className="space-y-2.5">
            {days.map(({ date, key, plan, isToday }, idx) => {
              const hasPlan = plan && plan.length > 0;
              return (
                <div
                  key={key}
                  className={`rounded-[16px] overflow-hidden transition-colors ${
                    isToday ? 'bg-white ring-2 ring-[#0A84FF]/60' : 'bg-white'
                  } shadow-sm`}
                >
                  <div className="flex items-center px-4 pt-3 pb-1">
                    <span className={`text-[15px] font-semibold ${isToday ? 'text-[#0A84FF]' : 'text-gray-900'}`}>
                      {isToday ? '今天' : idx === 0 ? '昨天' : WEEKDAYS[date.getDay()]}
                    </span>
                    <span className="text-[12px] text-gray-400 ml-2">
                      {date.getMonth() + 1}/{date.getDate()}
                    </span>
                    {hasPlan && (
                      <span className="ml-auto text-[12px] font-medium text-[#0A84FF] bg-[#E8F1FF] px-2 py-0.5 rounded-full">
                        {plan!.length} 个动作
                      </span>
                    )}
                  </div>
                  {hasPlan ? (
                    <div className="flex items-center px-4 pb-3">
                      <div className="flex-1 min-w-0 text-[13px] text-gray-500 truncate">
                        {plan!.slice(0, 3).map((ex: any) => ex.name || ex.title || '动作').join(' · ')}
                        {plan!.length > 3 ? ` 等 ${plan!.length} 项` : ''}
                      </div>
                      {/* 快捷按钮：直接发送并覆盖到"开始运动" */}
                      <button
                        onClick={() => applyPlan(plan!)}
                        aria-label="应用到今日训练"
                        className={`ml-3 shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full active:scale-90 transition-transform ${
                          isToday
                            ? 'bg-[#0A84FF] text-white'
                            : 'bg-[#E8F1FF] text-[#0A84FF]'
                        }`}
                      >
                        <Send className="w-3.5 h-3.5" strokeWidth={2.2} />
                        <span className="text-[12px] font-semibold">应用</span>
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 pb-3 text-[13px] text-gray-300">
                      {idx < 1 ? '无记录' : '暂无计划'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AIAgentHub;
