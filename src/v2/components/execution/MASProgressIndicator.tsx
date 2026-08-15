import React, { useState, useEffect, useRef } from 'react';

interface ProgressItem {
  id: string;
  category: 'Node' | 'Tool';
  name: string;
  status: 'running' | 'completed';
  timestamp: number;
}

interface MASProgressIndicatorProps {
  userId: string;
  sessionId: string;
  isBusy: boolean;
}

export const MASProgressIndicator: React.FC<MASProgressIndicatorProps> = ({
  userId,
  sessionId,
  isBusy
}) => {
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const prevSessionIdRef = useRef<string | undefined>(undefined);
  const prevIsBusyRef = useRef<boolean | undefined>(undefined);

  // 当 sessionId 变化时，清空旧的进度历史
  useEffect(() => {
    if (prevSessionIdRef.current !== undefined && prevSessionIdRef.current !== sessionId) {
      console.log('[MASProgressIndicator] Session changed, clearing items');
      setItems([]);
      setIsExpanded(false);
    }
    prevSessionIdRef.current = sessionId;
  }, [sessionId]);

  // 当开始生成新回复时（isBusy 从 false 变为 true），清空旧进度
  useEffect(() => {
    if (prevIsBusyRef.current !== undefined && !prevIsBusyRef.current && isBusy) {
      console.log('[MASProgressIndicator] New message started, clearing old progress');
      setItems([]);
      setIsExpanded(false);
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy]);

  const hasRunning = items.some(item => item.status === 'running');
  const hasProgress = items.length > 0;

  // 没有任何进度且不忙时不显示
  if (!hasProgress && !isBusy) return null;

  const runningItem = items.find(item => item.status === 'running');
  const displayItem = runningItem || items[items.length - 1];

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* 主指示器行 */}
      <div className="flex items-center gap-2 text-[10px] font-mono">
        {/* 圆点指示器 */}
        <div className="relative flex items-center justify-center">
          <div className={`absolute w-3 h-3 rounded-full bg-blue-500/20 ${hasRunning ? 'animate-[ping_1.5s_infinite]' : ''}`} />
          <div className={`relative w-2 h-2 rounded-full ${hasRunning ? 'bg-blue-600' : 'bg-gray-400'}`} />
        </div>

        {/* 默认显示：当前节点或最新节点 */}
        {!isExpanded && displayItem && (
          <span className={hasRunning && displayItem.status === 'running' ? 'text-gray-900 font-medium' : 'text-gray-600'}>
            [{displayItem.category}] {displayItem.name}
            {hasRunning && displayItem.status === 'running' && <span className="text-blue-600 ml-1">执行中...</span>}
          </span>
        )}

        {/* 展开/收起按钮 - 始终在固定位置 */}
        {hasProgress && items.length > 0 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            [{isExpanded ? `▲ 收起` : `▼ 显示全部 (${items.length})`}]
          </button>
        )}
      </div>

      {/* 展开显示完整链条 - 时间轴样式 */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex flex-col gap-2 ml-4 pl-4 border-l-2 border-gray-200">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 text-[10px] py-1"
            >
              {/* 左侧：类型标签 */}
              <span className="font-mono text-gray-400 uppercase text-[9px] min-w-[40px]">
                [{item.category}]
              </span>

              {/* 中间：节点名称 */}
              <span className={item.status === 'running' ? 'text-gray-900 font-medium' : 'text-gray-600'}>
                {item.name}
              </span>

              {/* 右侧：状态标记 */}
              <div className="flex items-center gap-2">
                {item.status === 'running' && (
                  <>
                    <span className="text-blue-600 text-[9px]">执行中...</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  </>
                )}
                {item.status === 'completed' && (
                  <>
                    <span className="text-green-600 text-[9px]">完成</span>
                    <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
