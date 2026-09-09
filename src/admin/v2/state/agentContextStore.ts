/**
 * Agent Context Store — 管理界面 Agent 对话的全局上下文附件池
 *
 * 设计要点（用户拍板的交互）：
 * - 用户在完整画像 sheet / 摘要卡里点击某区块 → 出现「+」→ 点击后该区块内容
 *   作为「上下文附件」挂到管理界面 Agent 对话窗口，**不是**塞进输入框文本。
 * - 附件与聊天输入分离：发送时才序列化进 message（后端 DeepAgentService.chat
 *   不读 metadata，App 端 survey_upload 的既有先例就是序列化进 message 文本）。
 * - 按目标用户隔离：切换选中用户时清空附件池（附件内容属于特定用户画像）。
 *
 * 用 useSyncExternalStore 实现的零依赖轻量 store（admin 侧无 zustand）。
 *
 * @module agentContextStore
 */

import { useSyncExternalStore } from 'react';

/** 一个上下文附件：来自画像的某个区块（或训练记录）。 */
export interface AgentContextAttachment {
  /** 稳定去重键，如 `profile_static:load_anchors` */
  id: string;
  /** 展示在 chip 上的短标题 */
  title: string;
  /** 来源分组（chip 颜色区分用） */
  source: 'profile' | 'session';
  /** 序列化进 message 的结构化内容 */
  content: Record<string, unknown>;
}

interface AgentContextState {
  attachments: AgentContextAttachment[];
  /** 最近一次添加/移除附件的信号（触发 chip 条动画用） */
  revision: number;
}

let state: AgentContextState = { attachments: [], revision: 0 };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state, revision: state.revision + 1 };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AgentContextState {
  return state;
}

export const agentContextStore = {
  subscribe,
  getSnapshot,

  /** 添加附件（已存在同 id 则忽略）。返回是否真正添加。 */
  add(attachment: AgentContextAttachment): boolean {
    if (state.attachments.some((a) => a.id === attachment.id)) return false;
    state = { ...state, attachments: [...state.attachments, attachment] };
    emit();
    return true;
  },

  remove(id: string) {
    if (!state.attachments.some((a) => a.id === id)) return;
    state = { ...state, attachments: state.attachments.filter((a) => a.id !== id) };
    emit();
  },

  clear() {
    if (state.attachments.length === 0) return;
    state = { ...state, attachments: [] };
    emit();
  },

  /** 序列化全部附件为将拼进 message 的文本块（无附件返回空串）。 */
  serialize(): string {
    if (state.attachments.length === 0) return '';
    const blocks = state.attachments.map((a) => {
      const json = JSON.stringify(a.content, null, 2);
      return `### ${a.title}\n\`\`\`json\n${json}\n\`\`\``;
    });
    return (
      '\n\n[Attached context — 管理员附加的画像/训练数据，回答时以此为准]\n' +
      blocks.join('\n\n')
    );
  },
};

/** React hook：读取当前附件列表。 */
export function useAgentContextAttachments(): AgentContextAttachment[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).attachments;
}

/** React hook：读取 revision（用于 chip 条入场动画重放）。 */
export function useAgentContextRevision(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).revision;
}
