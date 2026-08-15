/**
 * Delete User Confirmation Dialog Component
 *
 * Modal dialog for confirming user deletion.
 * Shows warning message and confirms the destructive action.
 *
 * @module DeleteUserConfirmDialog
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface DeleteUserConfirmDialogProps {
  userId: string;
  count?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteUserConfirmDialog: React.FC<DeleteUserConfirmDialogProps> = ({
  userId,
  count = 1,
  onConfirm,
  onCancel
}) => {
  const isBatch = count > 1;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      data-testid="delete-user-confirm-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {isBatch ? '批量删除用户' : '删除用户'}
              </h3>
              <p className="text-sm text-gray-500">
                此操作不可撤销
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-800 font-medium mb-2">
              ⚠️ 警告：此操作将永久删除以下数据
            </p>
            <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
              <li>用户账号信息</li>
              <li>所有训练记录</li>
              <li>用户画像数据</li>
              <li>RPE 日志和统计数据</li>
              <li>历史缓存记录</li>
            </ul>
          </div>

          <p className="text-sm text-gray-700">
            {isBatch ? (
              <>
                您确定要删除 <span className="font-semibold text-red-600">{count} 个用户</span> 吗？
                此操作将同时从置顶列表中移除这些用户。
              </>
            ) : (
              <>
                您确定要删除用户 <span className="font-semibold text-red-600">{userId}</span> 吗？
                此操作将同时从置顶列表中移除该用户。
              </>
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 bg-gray-50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            {isBatch ? `删除 ${count} 个用户` : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
};
