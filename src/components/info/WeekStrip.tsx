/**
 * WeekStrip — 本周横向 7 天条（C2 信息页上半，issue #6）。
 *
 * 配色同源（PR#17 返工）：与其他卡片同一灰阶体系（gray-50/gray-100 块、
 * gray-900 主文、gray-400 弱化）+ star-accent 仅用于选中态（蓝环+蓝字，
 * 对齐 ChatCardHeader 蓝点/star-accent 交互），不引入新色相。
 * 训练日/休息日层级靠字重与墨色表达：训练日深墨+块底加深，休息日灰。
 * 排印按 iosTypeScale：dow/mark = Caption 12，日号 = Subhead 15 semibold。
 */
import React from 'react';
import { haptic } from '../../lib/nativeHaptics';
import { dayNumber, dowShortLabel } from '../../utils/weeklyPlanView';

export interface WeekStripDay {
  date: string;
  /** 训练日（有当日条目） */
  isTrainDay: boolean;
  /** 格内标注：训练日=组数（如 4组），休息日显示「休」 */
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
            'flex flex-col items-center gap-0.5 rounded-2xl py-2 transition-colors border',
            d.isTrainDay ? 'border-gray-100 bg-gray-100' : 'border-gray-100 bg-gray-50',
            selected ? 'border-transparent bg-white ring-2 ring-inset ring-star-accent' : '',
          ].join(' ')}
        >
          <span className={`text-[12px] leading-none ${selected ? 'text-star-accent' : 'text-gray-400'}`}>
            {dowShortLabel(d.date)}
          </span>
          <span className={`text-[15px] font-semibold leading-tight ${selected ? 'text-star-accent' : d.isTrainDay ? 'text-gray-900' : 'text-gray-400'}`}>
            {dayNumber(d.date)}
          </span>
          <span className={`mt-0.5 min-h-[12px] text-[12px] leading-none ${d.isTrainDay ? 'font-medium text-gray-500' : 'text-gray-300'}`}>
            {d.mark}
          </span>
          {/* 今日角标：格底小圆点（不抢选中环的层级，色同 ChatCardHeader 蓝点） */}
          <span
            aria-hidden="true"
            className={`h-1 w-1 rounded-full ${isToday && !selected ? 'bg-blue-500/60' : 'bg-transparent'}`}
          />
        </button>
      );
    })}
  </div>
);
