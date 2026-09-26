/**
 * WeekStrip — 本周横向 7 天条（C2 信息页上半，issue #6）。
 *
 * 视觉依据 docs/design/mockups/d1-weekly-plan-ui.html 定稿：
 * 训练日橙色底高亮 / 休息日灰，选中日蓝环 + 蓝字；无进度/状态语义。
 */
import React from 'react';
import { haptic } from '../../lib/nativeHaptics';
import { dayNumber, dowShortLabel } from '../../utils/weeklyPlanView';

export interface WeekStripDay {
  date: string;
  /** 训练日（有当日条目） */
  isTrainDay: boolean;
  /** 格内标注：训练日=分化短标签（推/拉/腿…），休息日显示「休」 */
  mark: string;
}

export interface WeekStripProps {
  days: WeekStripDay[];
  selectedDate: string | null;
  todayDate: string;
  onSelect: (date: string) => void;
}

export const WeekStrip: React.FC<WeekStripProps> = ({ days, selectedDate, todayDate, onSelect }) => (
  <div className="grid grid-cols-7 gap-1.5">
    {days.map((d) => {
      const selected = d.date === selectedDate;
      const isToday = d.date === todayDate;
      return (
        <button
          key={d.date}
          type="button"
          role="button"
          aria-label={`${dowShortLabel(d.date)} ${dayNumber(d.date)} 日${d.isTrainDay ? `，${d.mark}` : '，休息日'}${selected ? '，已选中' : ''}`}
          onClick={() => {
            haptic('light');
            onSelect(d.date);
          }}
          className={[
            'flex flex-col items-center gap-0.5 rounded-[14px] py-2 transition-colors',
            d.isTrainDay ? 'bg-orange-50' : 'bg-gray-100',
            selected ? 'bg-white ring-2 ring-inset ring-star-accent' : '',
          ].join(' ')}
        >
          <span className={`text-[10.5px] leading-none ${selected ? 'text-star-accent' : 'text-gray-400'}`}>
            {dowShortLabel(d.date)}
          </span>
          <span className={`text-[15px] font-bold leading-tight ${selected ? 'text-star-accent' : 'text-gray-600'}`}>
            {dayNumber(d.date)}
          </span>
          <span className={`mt-0.5 min-h-[11px] text-[10px] font-bold leading-none ${d.isTrainDay ? 'text-orange-600' : 'font-medium text-gray-300'}`}>
            {d.mark}
          </span>
          {/* 今日角标：格底小圆点（不抢选中环的层级） */}
          <span
            aria-hidden="true"
            className={`h-1 w-1 rounded-full ${isToday && !selected ? 'bg-star-accent/60' : 'bg-transparent'}`}
          />
        </button>
      );
    })}
  </div>
);
