/**
 * User Management Page - Main Entry Point
 *
 * Implements the new user management interface with:
 * - Top user selector bar with pinned users
 * - Left/Right split content area (profile + training history)
 * - Light theme following Starfit design system
 *
 * @module UserManagementPage
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserSelectorBar } from './UserSelectorBar';
import { UserProfilePanelV2 } from './UserProfilePanel.v2';
import { TrainingHistoryPanel } from './TrainingHistoryPanel';
import { UserManagementDialog } from './dialogs/UserManagementDialog';
import { AdminService } from '../../services/api';
import { Button } from '../ui/Button';
import { Users } from 'lucide-react';
import { parseJSONSafe } from '../../../../types/validation';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserManagementPageProps {
  onOpenSettings?: () => void;
}

export const UserManagementPage: React.FC<UserManagementPageProps> = ({ onOpenSettings }) => {
  // User selection state
  const [users, setUsers] = useState<User[]>([]);
  const [pinnedUserIds, setPinnedUserIds] = useState<string[]>([]);
  const [isUpdatingPinned, setIsUpdatingPinned] = useState(false);
  const isUpdatingPinnedRef = useRef(false); // Use ref to avoid closure trap
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // User data state
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Dialog state
  const [managementDialogOpen, setManagementDialogOpen] = useState(false);

  // Computed: selected user info
  const selectedUser = users.find(u => u.id === selectedUserId);

  // Load users and pinned users on mount
  useEffect(() => {
    loadUsers();
    loadPinnedUsers();
  }, []);

  // WebSocket sync for pinned users updates
  useEffect(() => {
    let wsService: any;
    let mounted = true;
    let handlePinnedUsersUpdate: (() => void) | undefined;

    const initWebSocket = async () => {
      if (!mounted) return;

      const { wsService: ws } = await import('../../services/websocketService');
      wsService = ws;

      // Connect WebSocket (reuse admin identifier)
      wsService.connect('admin', 'admin-console');

      // Listen for pinned users update events
      handlePinnedUsersUpdate = () => {
        if (!isUpdatingPinnedRef.current) {
          loadPinnedUsers();
        }
      };

      wsService.on('pinned_users_updated', handlePinnedUsersUpdate);
    };

    initWebSocket();

    return () => {
      mounted = false;
      if (wsService) {
        if (handlePinnedUsersUpdate) {
          wsService.off('pinned_users_updated', handlePinnedUsersUpdate);
        }
        wsService.disconnect();
      }
    };
  }, []);

  // Load profile when user is selected
  useEffect(() => {
    if (selectedUserId) {
      loadUserProfile(selectedUserId);
    }
  }, [selectedUserId]);

  const loadUsers = async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const data = await AdminService.users.list();
      const SYSTEM_USER_IDS = ['system', 'global', 'admin'];
      const filteredData = data.filter((u: User) => !SYSTEM_USER_IDS.includes(u.id));
      setUsers(filteredData);
    } catch (error: any) {
      console.error('[UserManagementPage] Failed to load users:', error);
      setUsersError(error.message || 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadPinnedUsers = async () => {
    try {
      const result = await AdminService.configs.getPinnedUsers();
      setPinnedUserIds(result.pinned_users || []);
    } catch (error) {
      console.error('[UserManagementPage] Failed to load pinned users:', error);
    }
  };

  const loadUserProfile = async (userId: string) => {
    setLoadingProfile(true);
    try {
      const [p, s] = await Promise.all([
        AdminService.users.getProfile(userId),
        AdminService.users.getStats(userId)
      ]);

      // Parse JSON fields using parseJSONSafe (handles JSONB objects)
      const parseData = (data: any) => {
        return parseJSONSafe(data, 'UserManagementPage profile data') || {};
      };

      const parsed = {
        ...p,
        basic_info: parseData(p?.basic_info),
        preferences: parseData(p?.preferences),
        load_anchors: parseData(p?.load_anchors),
        physiological: parseData(p?.physiological),
        psychological: parseData(p?.psychological),
        training_strategy: p?.training_strategy || null,
        red_flags: Array.isArray(p?.red_flags) ? p.red_flags : (parseJSONSafe(p?.red_flags, 'red_flags') || [])
      };

      setProfile(parsed);
      setStats(s);
    } catch (error) {
      console.error('[UserManagementPage] Failed to load user profile:', error);
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleUserSelect = useCallback((userId: string) => {
    setSelectedUserId(userId);
  }, []);

  const handleTogglePin = async (userId: string) => {
    isUpdatingPinnedRef.current = true; // Mark start of update (using ref)
    setIsUpdatingPinned(true); // Also update state for UI if needed
    try {
      const result = await AdminService.configs.togglePinnedUser(userId);
      setPinnedUserIds(result.pinned_users || []);
    } catch (error) {
      console.error('[UserManagementPage] Failed to toggle pin:', error);
    } finally {
      // Delay reset to avoid race condition with WebSocket event
      setTimeout(() => {
        isUpdatingPinnedRef.current = false;
        setIsUpdatingPinned(false);
      }, 300);
    }
  };

  const handleUserDeleted = useCallback(() => {
    setSelectedUserId(null);
    setProfile(null);
    setStats(null);
    loadUsers();
    loadPinnedUsers();
  }, []);

  const handleBatchDeleteUsers = async (userIds: string[]) => {
    try {
      await AdminService.users.batchDelete(userIds);
      await handleUserDeleted();
    } catch (error) {
      console.error('[UserManagementPage] Failed to batch delete users:', error);
      alert('删除用户失败: ' + (error as Error).message);
    }
  };

  const handleBatchPinUsers = async (userIds: string[]) => {
    isUpdatingPinnedRef.current = true;
    setIsUpdatingPinned(true);
    try {
      const currentPinned = await AdminService.configs.getPinnedUsers();
      const newPinned = [...new Set([...currentPinned.pinned_users, ...userIds])];
      await AdminService.configs.setPinnedUsers(newPinned);
      await loadPinnedUsers(); // Ensure state synchronization
    } catch (error) {
      console.error('[UserManagementPage] Failed to batch pin users:', error);
      alert('批量置顶失败: ' + (error as Error).message);
      throw error;
    } finally {
      setTimeout(() => {
        isUpdatingPinnedRef.current = false;
        setIsUpdatingPinned(false);
      }, 300);
    }
  };

  const handleBatchUnpinUsers = async (userIds: string[]) => {
    isUpdatingPinnedRef.current = true;
    setIsUpdatingPinned(true);
    try {
      const currentPinned = await AdminService.configs.getPinnedUsers();
      const newPinned = currentPinned.pinned_users.filter(id => !userIds.includes(id));
      await AdminService.configs.setPinnedUsers(newPinned);
      await loadPinnedUsers(); // Ensure state synchronization
    } catch (error) {
      console.error('[UserManagementPage] Failed to batch unpin users:', error);
      alert('取消置顶失败: ' + (error as Error).message);
      throw error;
    } finally {
      setTimeout(() => {
        isUpdatingPinnedRef.current = false;
        setIsUpdatingPinned(false);
      }, 300);
    }
  };

  const handleExportAll = async () => {
    try {
      const data = {
        export_timestamp: new Date().toISOString(),
        users: users.map(u => ({
          id: u.id,
          session_count: u.session_count,
          created_at: u.created_at,
          device_id: u.device_id
        })),
        pinned_users: pinnedUserIds
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `starfit_users_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert('导出失败: ' + (error as Error).message);
    }
  };

  // Sort users: pinned first, then by recent activity
  const sortedUsers = [...users].sort((a, b) => {
    const aPinned = pinnedUserIds.includes(a.id);
    const bPinned = pinnedUserIds.includes(b.id);

    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // Both pinned or both not pinned - sort by created_at (most recent first)
    return b.created_at - a.created_at;
  });

  return (
    <div className="flex flex-col h-full bg-star-white" data-testid="user-management-page">
      {/* User Selector Bar */}
      <UserSelectorBar
        users={sortedUsers}
        pinnedUserIds={pinnedUserIds}
        selectedUserId={selectedUserId}
        loading={loadingUsers}
        error={usersError}
        onUserSelect={handleUserSelect}
        onTogglePin={handleTogglePin}
        onRefresh={async () => {
          await loadUsers();
          await loadPinnedUsers();
          // 同时刷新当前用户画像
          if (selectedUserId) {
            await loadUserProfile(selectedUserId);
          }
        }}
        onOpenManagementDialog={() => setManagementDialogOpen(true)}
      />

      {/* Main Content Area - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {selectedUserId ? (
          <>
            {/* Left Panel - User Profile (Expanded width) */}
            <div className="w-[55%] min-w-[600px] border-r border-gray-200 overflow-hidden">
              <UserProfilePanelV2
                userId={selectedUserId}
                username={selectedUser?.username}
                short_id={selectedUser?.short_id}
                display_name={selectedUser?.display_name}
                profile={profile}
                stats={stats}
                loading={loadingProfile}
                onStatsUpdate={setStats}
              />
            </div>

            {/* Right Panel - Training History */}
            <div className="flex-1 overflow-hidden">
              <TrainingHistoryPanel
                userId={selectedUserId}
                loading={loadingProfile}
                onSessionDeleted={handleUserDeleted}
                onLoadMoreSessions={async (limit, offset) => {
                  return await AdminService.users.getSessions(selectedUserId, limit, offset);
                }}
              />
            </div>
          </>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <Users size={48} className="text-gray-400" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">选择用户查看详情</h2>
              <p className="text-gray-500">
                从上方选择一个用户，或点击 <span className="font-medium">"+"</span> 按钮管理用户
              </p>
            </div>
          </div>
        )}
      </div>

      {/* User Management Dialog */}
      {managementDialogOpen && (
        <UserManagementDialog
          users={users}
          pinnedUserIds={pinnedUserIds}
          onClose={() => setManagementDialogOpen(false)}
          onTogglePin={handleTogglePin}
          onDelete={handleBatchDeleteUsers}
          onRefresh={async () => {
            await loadUsers();
            await loadPinnedUsers();
            // 同时刷新当前用户画像
            if (selectedUserId) {
              await loadUserProfile(selectedUserId);
            }
          }}
          onBatchPin={handleBatchPinUsers}
          onBatchUnpin={handleBatchUnpinUsers}
        />
      )}
    </div>
  );
};
