import React, { useState, useMemo } from 'react';
import { X, Search, RefreshCw, Trash2, Pin, PinOff, Users } from 'lucide-react';
import { UserCard } from './UserCard';
import { DeleteUserConfirmDialog } from './DeleteUserConfirmDialog';
import { AdminService } from '../../../services/api';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserManagementDialogProps {
  users: User[];
  pinnedUserIds: string[];
  onClose: () => void;
  onTogglePin: (userId: string) => void;
  onDelete: (userIds: string[]) => Promise<void>;
  onRefresh: () => Promise<void>;
  onBatchPin?: (userIds: string[]) => Promise<void>;
  onBatchUnpin?: (userIds: string[]) => Promise<void>;
}

type SortBy = 'recent' | 'name' | 'sessions';
type FilterBy = 'all' | 'pinned' | 'active' | 'inactive';

export const UserManagementDialog: React.FC<UserManagementDialogProps> = ({
  users,
  pinnedUserIds,
  onClose,
  onTogglePin,
  onDelete,
  onRefresh,
  onBatchPin,
  onBatchUnpin
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [filterBy, setFilterBy] = useState<FilterBy>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | string[]>('');

  const filteredUsers = useMemo(() => {
    let filtered = [...users];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(u =>
        u.id.toLowerCase().includes(query) ||
        u.username?.toLowerCase().includes(query) ||
        u.short_id?.toLowerCase().includes(query) ||
        u.display_name?.toLowerCase().includes(query)
      );
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    switch (filterBy) {
      case 'pinned':
        filtered = filtered.filter(u => pinnedUserIds.includes(u.id));
        break;
      case 'active':
        filtered = filtered.filter(u => u.created_at > sevenDaysAgo || u.session_count > 0);
        break;
      case 'inactive':
        filtered = filtered.filter(u => u.created_at <= sevenDaysAgo && u.session_count === 0);
        break;
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          const aName = a.display_name || a.username || a.short_id || a.id;
          const bName = b.display_name || b.username || b.short_id || b.id;
          return aName.localeCompare(bName);
        case 'sessions':
          return b.session_count - a.session_count;
        case 'recent':
        default:
          return b.created_at - a.created_at;
      }
    });

    return filtered;
  }, [users, searchQuery, sortBy, filterBy, pinnedUserIds]);

  const pinnedUsers = filteredUsers.filter(u => pinnedUserIds.includes(u.id));
  const otherUsers = filteredUsers.filter(u => !pinnedUserIds.includes(u.id));

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectAll) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(filteredUsers.map(u => u.id));
    }
    setSelectAll(!selectAll);
  };

  const handleToggleSelectUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const handleBatchDelete = () => {
    if (selectedUserIds.length === 0) return;
    setUserToDelete(selectedUserIds);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSingle = (userId: string) => {
    setUserToDelete(userId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    await onDelete(Array.isArray(userToDelete) ? userToDelete : [userToDelete]);
    setSelectedUserIds([]);
    setDeleteDialogOpen(false);
    setUserToDelete('');
  };

  const handleBatchPin = async () => {
    if (selectedUserIds.length === 0) return;

    try {
      if (onBatchPin) {
        await onBatchPin(selectedUserIds);
      }
      setSelectedUserIds([]);
      setSelectAll(false);
    } catch (error) {
      console.error('[UserManagementDialog] Batch pin failed:', error);
      alert('批量置顶失败: ' + (error as Error).message);
    }
  };

  const handleBatchUnpin = async () => {
    if (selectedUserIds.length === 0) return;

    try {
      if (onBatchUnpin) {
        await onBatchUnpin(selectedUserIds);
      }
      setSelectedUserIds([]);
      setSelectAll(false);
    } catch (error) {
      console.error('[UserManagementDialog] Batch unpin failed:', error);
      alert('取消置顶失败: ' + (error as Error).message);
    }
  };

  const handleDisplayNameUpdate = async (userId: string, displayName: string) => {
    try {
      const result = await AdminService.users.updateDisplayName(userId, displayName);
      if (result.success) {
        await onRefresh();
      } else {
        throw new Error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('[UserManagementDialog] Update display name error:', error);
      throw error;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" data-testid="user-management-dialog">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">管理用户</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="搜索用户ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent focus:border-transparent"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent bg-white"
            >
              <option value="recent">最近活跃</option>
              <option value="name">用户ID</option>
              <option value="sessions">训练次数</option>
            </select>

            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterBy)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-star-accent bg-white"
            >
              <option value="all">全部用户</option>
              <option value="pinned">置顶用户</option>
              <option value="active">活跃用户</option>
              <option value="inactive">非活跃用户</option>
            </select>

            <div className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
              🔵 {filteredUsers.length} 个用户
            </div>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
              title="刷新"
            >
              <RefreshCw size={20} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          {selectedUserIds.length > 0 && (
            <div className="flex items-center gap-4 mt-4 p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={handleToggleSelectAll}
                  className="w-4 h-4 text-star-accent rounded focus:ring-star-accent"
                />
                <span className="text-sm font-medium text-blue-700">
                  已选择 {selectedUserIds.length} 个用户
                </span>
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <button
                  onClick={handleBatchPin}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <Pin size={16} />
                  批量置顶
                </button>
                <button
                  onClick={handleBatchUnpin}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <PinOff size={16} />
                  取消置顶
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                  批量删除
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredUsers.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Search size={48} className="text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">未找到匹配的用户</h3>
                <p className="text-gray-500">请尝试调整搜索词或筛选条件</p>
              </div>
            </div>
          ) : (
            <>
              {pinnedUsers.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                    <Pin size={16} />
                    置顶用户 ({pinnedUsers.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {pinnedUsers.map(user => (
                      <UserCard
                        key={user.id}
                        user={user}
                        pinned={pinnedUserIds.includes(user.id)}
                        selected={selectedUserIds.includes(user.id)}
                        onSelect={() => handleToggleSelectUser(user.id)}
                        onTogglePin={() => onTogglePin(user.id)}
                        onDelete={() => handleDeleteSingle(user.id)}
                        onDisplayNameUpdate={handleDisplayNameUpdate}
                      />
                    ))}
                  </div>
                </div>
              )}

              {otherUsers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                    <Users size={16} />
                    <span>全部用户 ({otherUsers.length})</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {otherUsers.map(user => (
                      <UserCard
                        key={user.id}
                        user={user}
                        pinned={pinnedUserIds.includes(user.id)}
                        selected={selectedUserIds.includes(user.id)}
                        onSelect={() => handleToggleSelectUser(user.id)}
                        onTogglePin={() => onTogglePin(user.id)}
                        onDelete={() => handleDeleteSingle(user.id)}
                        onDisplayNameUpdate={handleDisplayNameUpdate}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {selectedUserIds.length > 0
              ? `已选择 ${selectedUserIds.length} 个用户`
              : `共 ${filteredUsers.length} 个用户`
            }
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            关闭
          </button>
        </div>
      </div>

      {deleteDialogOpen && (
        <DeleteUserConfirmDialog
          userId={Array.isArray(userToDelete) ? userToDelete[0] : userToDelete}
          count={Array.isArray(userToDelete) ? userToDelete.length : 1}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setDeleteDialogOpen(false);
            setUserToDelete('');
          }}
        />
      )}
    </div>
  );
};
