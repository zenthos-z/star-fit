import React, { useState, useEffect } from 'react';
import { X, Save, RotateCcw, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface EditTrainingStrategyDialogProps {
  initialData: string | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: string) => Promise<void>;
}

const DEFAULT_STRATEGY = `# 训练策略配置

> 这是用户的个性化训练规则文件，类似于 AI 系统提示词。
> 请根据实际情况灵活修改，无需固定格式。

---

## 基本协议

### 协议 A：核心刚性 (The Canister)
- 在任何负重动作前，执行“呼气并下沉肋骨”以锁定腹内压。
- 如果训练中出现下背部拱起或肋骨外翻，立即停止。

### 协议 B：离心控制 (节奏 3-1-1-0)
- **3s** 缓慢离心 (下放)
- **1s** 底部暂停 (消除惯性)
- **1s** 爆发向心 (举起)

### 协议 C：有氧三明治
- 顺序：力量训练 → 核心锁定 → 有氧恢复

---

## 矫正协议

### 协议 D：单呼吸重置
- 吸气锁定 → 完成一次动作 → 回到起始位置并完全呼气重置 → 重新吸气锁定

### 协议 E：心率熔断器
- 力量日限制：训练前无活动 > 130 bpm。
- 训练后熔断：如果心率无法稳定在 130 bpm 以下，立即停止。

### 协议 F：弱侧优先
- 单侧动作必须从左侧开始。
- 强侧的组数和次数必须严格与弱侧对齐。

---

## 进阶逻辑

### 进阶条件 (需满足所有 3 点)
1. RPE < 6 (主观感觉非常轻松)
2. 全程严格离心控制
3. 关节或肌肉附着点无异常反馈

### 降阶信号 (出现任意 1 点 -> 减负)
1. 神经预警：不自主颤抖，力量断崖式下跌
2. 机械故障：代偿，晃动，动作变形
3. 疼痛信号：动作中/后出现刺痛或异常紧绷

---

## 每日序列

- **Day A (拉)**: 上斜划船 → 高位下拉 → 反向飞鸟 → 二头弯举 → 核心
- **Day B (推)**: 卧推 → 过顶推举 → 侧平举 → 三头下压 → 核心
- **Day C (腿)**: 靠墙臀桥 → 深蹲 → 罗马尼亚硬拉 → 静态分腿蹲 → 核心
- **Day D (系统重置)**: 强制关机，无负重，仅限 Zone 1 步行或静态拉伸

---

*最后更新: ${new Date().toLocaleString()}*`;

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export const EditTrainingStrategyDialog: React.FC<EditTrainingStrategyDialogProps> = ({
  initialData,
  open,
  onClose,
  onSave
}) => {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [content, setContent] = useState(DEFAULT_STRATEGY);

  useEffect(() => {
    if (open) {
      setContent(initialData || DEFAULT_STRATEGY);
      setSaveError(null);
      setSaveStatus('idle');
    }
  }, [open, initialData]);

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await onSave(content);
      setSaveStatus('success');
      // Show success state briefly before closing
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (error: any) {
      setSaveError(error.message || '保存失败');
      setSaveStatus('error');
    }
  };

  const handleReset = () => {
    if (window.confirm('重置为默认策略？当前内容将丢失。')) {
      setContent(DEFAULT_STRATEGY);
      setSaveStatus('idle');
      setSaveError(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-white border-gray-200 text-gray-900 shadow-2xl">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">编辑训练策略</h2>
            <p className="text-sm text-gray-500 mt-1">
              类 AI 系统提示词的训练规则，支持 Markdown。
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[500px] px-4 py-3 bg-white border border-gray-300 rounded-lg font-mono text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none placeholder-gray-400"
            placeholder="输入训练策略 (支持 Markdown)"
            spellCheck={false}
          />
        </div>

        {saveStatus === 'error' && saveError && (
          <div className="px-6 py-3 bg-red-50 text-red-600 text-sm border-t border-red-100 flex items-center gap-2">
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex justify-between items-center p-6 border-t border-gray-200 bg-white">
          <Button
            variant="ghost"
            onClick={handleReset}
            icon={<RotateCcw size={16} />}
            className="text-gray-500 hover:text-gray-900 hover:bg-gray-100"
          >
            重置为默认
          </Button>
          <div className="flex items-center gap-3">
            {/* Save Status Indicator */}
            {saveStatus !== 'idle' && (
              <div className="flex items-center gap-2">
                {saveStatus === 'saving' && (
                  <>
                    <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-xs text-yellow-600">保存中...</span>
                  </>
                )}
                {saveStatus === 'success' && (
                  <>
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-xs text-green-600">保存成功</span>
                  </>
                )}
                {saveStatus === 'error' && (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-xs text-red-600">保存失败</span>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={saveStatus === 'saving' || saveStatus === 'success'}
                className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                取消
              </Button>
              <Button
                onClick={handleSave}
                loading={saveStatus === 'saving'}
                disabled={saveStatus === 'success'}
                icon={<Save size={16} />}
              >
                {saveStatus === 'success' ? '已保存' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default EditTrainingStrategyDialog;
