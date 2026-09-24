/**
 * EnvironmentCard — 运行环境与数据管理（设置页「Agent 与运行环境」区）。
 *
 * - 服务器地址 / 访问令牌状态（同步读 localStorage，权威来源）
 * - 数据管理：导出 JSON 备份 / 导出 Markdown 战报 / 导入备份
 *   （从 History ··· 菜单迁入，2026-09-11 拍板）
 *
 * @version 2.0.0
 */

import React, { useRef } from 'react';
import { API_BASE, getHeaders } from '../../services/geminiService';
import type { Session } from '@/src/types/legacy';

// ============================================================================
// Types
// ============================================================================

interface EnvironmentCardProps {
  /** 当前用户训练记录（导出 JSON/Markdown 用） */
  sessions: Session[];
  /** 导入备份并合并到历史（App.tsx handleImportHistory） */
  onImport: (sessions: Session[]) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export function EnvironmentCard({ sessions, onImport }: EnvironmentCardProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步读 localStorage（与 geminiService 同源）
  const serverUrl = localStorage.getItem('starfit_server_url') || API_BASE;
  const accessTokenSet = !!localStorage.getItem('starfit_access_token');

  const handleExportJSON = () => {
    if (sessions.length === 0) {
      alert('暂无记录可导出');
      return;
    }
    const dataStr = JSON.stringify(sessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starfit_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = async () => {
    if (sessions.length === 0) {
      alert('暂无记录可导出');
      return;
    }

    try {
      const uid = localStorage.getItem('starfit_user_id');
      if (!uid) {
        alert('用户未登录，无法导出 Markdown 报告');
        return;
      }

      const res = await fetch(`${API_BASE}/admin/users/${uid}/export-markdown`, {
        headers: getHeaders(),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `导出失败: ${res.status}`);
      }

      const data = await res.json();
      const blob = new Blob([data.markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_report_${uid.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出报告失败: ' + (err as Error).message);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const result = evt.target?.result as string;
        const parsed = JSON.parse(result);
        if (Array.isArray(parsed)) {
          const isValid = parsed.every(s => s.id && s.startTime && Array.isArray(s.exercises));
          if (!isValid) {
            alert('文件格式不正确，无法识别为 Starfit 数据。');
            return;
          }

          if (window.confirm(`解析到 ${parsed.length} 条记录。\n是否导入并合并到现有记录中？`)) {
            onImport(parsed);
          }
        } else {
          alert('文件格式错误 (非数组)。');
        }
      } catch (err) {
        alert('文件解析失败，请确保是有效的 JSON 备份文件。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <h2 className="text-lg font-bold text-gray-900 tracking-tight mb-4">运行环境</h2>

      {/* 服务器与令牌 */}
      <div className="space-y-3 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 shrink-0">服务器地址</span>
          <span className="text-sm font-semibold text-gray-900 font-mono text-right break-all">{serverUrl}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">访问令牌</span>
          <span className={`text-sm font-semibold ${accessTokenSet ? 'text-green-600' : 'text-gray-400'}`}>
            {accessTokenSet ? '已配置' : '未配置'}
          </span>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="pt-4">
        <p className="text-xs text-gray-400 font-medium mb-3">数据管理</p>
        <div className="space-y-2">
          <button
            onClick={handleExportMarkdown}
            className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200/70 transition-colors text-left"
          >
            <span className="text-sm font-medium text-gray-800">导出 Markdown 战报</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </button>
          <button
            onClick={handleExportJSON}
            className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200/70 transition-colors text-left"
          >
            <span className="text-sm font-medium text-gray-800">导出 JSON 备份</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </button>
          <button
            onClick={handleImportClick}
            className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200/70 transition-colors text-left"
          >
            <span className="text-sm font-medium text-gray-800">导入备份</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-18-9l6.75-6.75L12 4.5m-9 3L9.75 11.25M12 4.5v9" />
            </svg>
          </button>
        </div>
      </div>

      {/* 隐藏文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

export default EnvironmentCard;
