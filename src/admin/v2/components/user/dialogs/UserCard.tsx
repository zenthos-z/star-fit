import React, { useState } from 'react';
import { Pin, PinOff, Trash2, Medal, Activity, Wifi, WifiOff, Edit2, X, Check } from 'lucide-react';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserCardProps {
  user: User;
  pinned: boolean;
  selected: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onDisplayNameUpdate?: (userId: string, displayName: string) => Promise<void>;
}

export const UserCard: React.FC<UserCardProps> = ({
  user,
  pinned,
  selected,
  onSelect,
  onTogglePin,
  onDelete,
  onDisplayNameUpdate
}) => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isOnline = user.created_at > sevenDaysAgo || user.session_count > 0;

  // Display name editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(user.display_name || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleStartEdit = () => {
    setEditingName(user.display_name || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditingName(user.display_name || '');
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!onDisplayNameUpdate) return;
    setIsSaving(true);
    try {
      await onDisplayNameUpdate(user.id, editingName.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update display name:', error);
      alert('更新显示名称失败: ' + (error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const getLastActiveTime = () => {
    const now = Date.now();
    const diff = now - user.created_at;

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return '一周前';
  };

  const getFitnessBadge = () => {
    const sessions = user.session_count || 0;
    if (sessions >= 50) return { label: '高级', color: 'bg-purple-100 text-purple-700' };
    if (sessions >= 25) return { label: '中级', color: 'bg-green-100 text-green-700' };
    if (sessions >= 10) return { label: '初级', color: 'bg-blue-100 text-blue-700' };
    return { label: '新手', color: 'bg-gray-100 text-gray-700' };
  };

  const fitnessBadge = getFitnessBadge();

  return (
    <div
      className={`
        relative bg-white border-2 rounded-lg p-4 cursor-pointer transition-all hover:shadow-md
        ${selected ? 'border-star-accent ring-2 ring-star-accent/20' : 'border-gray-200 hover:border-star-accent/50'}
      `}
      onClick={onSelect}
    >
      <div className="absolute top-3 left-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="w-4 h-4 text-star-accent rounded focus:ring-star-accent cursor-pointer"
        />
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        className={`absolute top-3 right-3 p-1.5 rounded-lg transition-colors ${
          pinned ? 'text-star-accent bg-star-accent/10 hover:bg-star-accent/20' : 'text-gray-400 hover:bg-gray-100'
        }`}
        title={pinned ? '取消置顶' : '置顶'}
      >
        {pinned ? <Pin size={16} /> : <PinOff size={16} />}
      </button>

      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500 mb-1">显示名称</div>
          <div className="flex items-center gap-2">
            <div className={`px-2 py-0.5 rounded text-[10px] font-medium ${fitnessBadge.color}`}>
              {fitnessBadge.label}
            </div>
            {onDisplayNameUpdate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isEditing) {
                    handleCancelEdit();
                  } else {
                    handleStartEdit();
                  }
                }}
                className="p-1 text-gray-400 hover:text-star-accent hover:bg-star-accent/10 rounded transition-colors"
                title={isEditing ? '取消' : '编辑名称'}
              >
                {isEditing ? <X size={14} /> : <Edit2 size={14} />}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 px-2 py-1 text-sm font-medium text-gray-900 border border-star-accent/30 rounded focus:outline-none focus:ring-2 focus:ring-star-accent/20"
                maxLength={50}
                autoFocus
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveEdit();
                }}
                disabled={isSaving || !editingName.trim()}
                className="p-1 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                title="保存"
              >
                <Check size={14} />
              </button>
            </>
          ) : (
            <div className="text-sm font-semibold text-gray-900 truncate" title={user.display_name || user.id}>
              {user.display_name || '未设置名称'}
            </div>
          )}
        </div>

        {(user.username || user.short_id) && (
          <div>
            <div className="text-xs text-gray-500 mb-1">{user.username ? 'Short ID' : 'UUID'}</div>
            <div className="text-sm text-gray-700 truncate" title={user.short_id || user.id}>
              {user.short_id || user.id.slice(0, 8) + '...'}
            </div>
          </div>
        )}

        {user.device_id && (
          <div>
            <div className="text-xs text-gray-500 mb-1">设备ID</div>
            <div className="text-sm text-gray-700 truncate" title={user.device_id}>
              {user.device_id}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1">
            {isOnline ? (
              <Wifi size={12} className="text-green-500" />
            ) : (
              <WifiOff size={12} className="text-gray-400" />
            )}
            <span className="text-xs text-gray-500">
              {getLastActiveTime()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
          <div className="flex-1">
            <div className="text-xs text-gray-500 mb-1">训练次数</div>
            <div className="text-sm font-medium text-gray-900 flex items-center gap-1">
              <Activity size={14} />
              {user.session_count}
            </div>
          </div>
          <div className="flex-1 text-right">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="删除用户"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
