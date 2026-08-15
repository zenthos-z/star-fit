import React, { useState } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AdminService } from '../../services/api';

interface AccountSettingsDialogProps {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  onUserChanged: () => void;
}

export const AccountSettingsDialog: React.FC<AccountSettingsDialogProps> = ({
  userId,
  userName,
  open,
  onClose,
  onDelete,
  onUserChanged
}) => {
  const [tab, setTab] = useState<'profile' | 'danger'>('profile');
  const [newUserId, setNewUserId] = useState(userId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;

    setDeleting(true);
    setError(null);
    try {
      await AdminService.users.delete(userId);
      onDelete();
    } catch (error: any) {
      setError(error.message || 'Delete failed');
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col bg-white border-gray-200 shadow-2xl">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">账户设置</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-gray-200 bg-gray-50">
          {[
            { id: 'profile', label: '基本资料' },
            { id: 'danger', label: '危险区域' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'text-star-accent border-b-2 border-star-accent bg-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6 bg-white">
          {tab === 'profile' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="text-lg font-bold text-gray-900">用户 ID</h3>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">当前 ID</label>
                <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm text-gray-700">
                  {userId}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">修改 ID (暂未实现)</label>
                <div className="flex gap-2 opacity-50 cursor-not-allowed">
                  <input
                    type="text"
                    value={newUserId}
                    disabled
                    onChange={(e) => setNewUserId(e.target.value)}
                    placeholder="输入新 ID"
                    className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500"
                  />
                  <Button disabled>应用</Button>
                </div>
              </div>
            </div>
          )}

          {tab === 'danger' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
              <h3 className="text-lg font-bold text-red-600">危险区域</h3>
              
              {!showDeleteConfirm ? (
                <div className="space-y-4">
                  <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="text-red-500 flex-shrink-0" size={24} />
                      <div>
                        <h4 className="font-bold text-red-700 mb-2">删除用户账户</h4>
                        <p className="text-sm text-red-600/80 mb-2">
                          此操作将永久删除该用户的所有数据，包括：
                        </p>
                        <ul className="text-sm text-red-600/80 list-disc list-inside space-y-1">
                          <li>所有训练会话和历史记录</li>
                          <li>用户画像和偏好设置</li>
                          <li>负荷锚点数据</li>
                          <li>上传的媒体文件</li>
                        </ul>
                        <p className="text-sm text-red-600 font-medium mt-3">
                          此操作无法撤销！
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <Button
                    variant="danger"
                    onClick={() => setShowDeleteConfirm(true)}
                    icon={<Trash2 size={16} />}
                  >
                    删除用户账户
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                    <h4 className="font-bold text-red-700 mb-3">确认删除</h4>
                    <p className="text-sm text-red-600/80 mb-4">
                      请输入 <code className="bg-red-100 px-2 py-1 rounded font-mono text-red-700">DELETE</code> 以确认删除用户 "{userName}"
                    </p>
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value.toUpperCase())}
                      placeholder="输入 DELETE"
                      className="w-full px-4 py-2 bg-white border border-red-200 rounded-lg text-red-600 focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder-red-300"
                    />
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirm('');
                      }}
                      className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    >
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirm !== 'DELETE' || deleting}
                      icon={deleting ? undefined : <Trash2 size={16} />}
                    >
                      {deleting ? '删除中...' : '确认删除'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-50 text-red-600 text-sm border-t border-red-100">
            {error}
          </div>
        )}

        <div className="flex justify-end p-6 border-t border-gray-200 bg-gray-50">
          <Button variant="secondary" onClick={onClose} disabled={saving || deleting} className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50">
            关闭
          </Button>
        </div>
      </Card>
    </div>
  );
};
