/**
 * User Selector Bar Component
 *
 * Displays a horizontal bar with user pills for quick selection.
 * Pinned users are shown first, followed by a dropdown for other users.
 *
 * @module UserSelectorBar
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPill } from './UserPill';
import { UserDropdown } from './UserDropdown';
import { Button } from '../ui/Button';
import { Plus, RefreshCw, User, Download, Settings } from 'lucide-react';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserSelectorBarProps {
  users: User[];
  pinnedUserIds: string[];
  selectedUserId: string | null;
  loading: boolean;
  error: string | null;
  onUserSelect: (userId: string) => void;
  onTogglePin: (userId: string) => void;
  onRefresh: () => void;
  onOpenManagementDialog: () => void;
}

export const UserSelectorBar: React.FC<UserSelectorBarProps> = ({
  users,
  pinnedUserIds,
  selectedUserId,
  loading,
  error,
  onUserSelect,
  onTogglePin,
  onRefresh,
  onOpenManagementDialog
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  // Separate pinned and non-pinned users
  const pinnedUsers = users.filter(u => pinnedUserIds.includes(u.id));
  const otherUsers = users.filter(u => !pinnedUserIds.includes(u.id));

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside trigger button and dropdown
      const isClickInTrigger = triggerButtonRef.current?.contains(target);
      const isClickInDropdown = (target as HTMLElement)?.closest('[data-user-dropdown]') !== null;

      if (!isClickInTrigger && !isClickInDropdown) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleManageUsers = () => {
    onOpenManagementDialog();
  };

  const displayedUserCount = pinnedUsers.length + 1; // pinned + "..." dropdown

  return (
    <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 px-6 py-4 sticky top-0 z-10" data-testid="user-selector-bar">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
        {/* Label */}
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 whitespace-nowrap">
          <User size={16} />
          <span>当前用户:</span>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="text-sm text-gray-500">加载中...</div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}

        {/* No users state */}
        {!loading && !error && users.length === 0 && (
          <div className="text-sm text-gray-400">暂无用户</div>
        )}

        {/* User pills */}
        {!loading && !error && users.length > 0 && (
          <div className="flex items-center gap-3 flex-1 overflow-x-auto no-scrollbar py-1">
            {/* Pinned users */}
            {pinnedUsers.map(user => (
              <UserPill
                key={user.id}
                user={user}
                selected={selectedUserId === user.id}
                pinned={true}
                onClick={() => onUserSelect(user.id)}
                onTogglePin={() => onTogglePin(user.id)}
              />
            ))}

            {pinnedUsers.length > 0 && otherUsers.length > 0 && (
              <div className="w-px h-8 bg-gray-200 mx-1 flex-shrink-0" />
            )}

            {/* Other users dropdown trigger */}
            {otherUsers.length > 0 && (
              <div className="relative">
                <button
                  ref={triggerButtonRef}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className={`
                    px-3 py-1.5 rounded-full text-sm font-medium transition-all
                    ${selectedUserId && !pinnedUserIds.includes(selectedUserId)
                      ? 'bg-star-accent text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                  data-testid="user-dropdown-trigger"
                >
                  <span className="mr-1">...</span>
                  <span className="text-xs">({otherUsers.length})</span>
                </button>

                {/* Dropdown menu - rendered via portal to escape overflow containers */}
                {dropdownOpen && createPortal(
                  <UserDropdown
                    users={otherUsers}
                    pinnedUserIds={pinnedUserIds}
                    selectedUserId={selectedUserId}
                    onUserSelect={(userId) => {
                      onUserSelect(userId);
                      setDropdownOpen(false);
                    }}
                    onTogglePin={onTogglePin}
                    onClose={() => setDropdownOpen(false)}
                    triggerRef={triggerButtonRef}
                  />,
                  document.body
                )}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {!loading && !error && users.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              className="text-gray-500 hover:text-gray-700"
              title="刷新用户列表"
            >
              <RefreshCw size={16} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleManageUsers}
            >
              <Plus size={16} className="mr-1" />
              管理用户
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
