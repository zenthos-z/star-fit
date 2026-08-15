/**
 * User Dropdown Component
 *
 * Dropdown menu showing non-pinned users for selection.
 * Uses fixed positioning and portal to escape overflow containers.
 *
 * Display priority: username > short_id > UUID prefix
 *
 * @module UserDropdown
 */

import React, { useRef, useEffect, useState } from 'react';
import { Pin, PinOff, X } from 'lucide-react';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserDropdownProps {
  users: User[];
  pinnedUserIds: string[];
  selectedUserId: string | null;
  onUserSelect: (userId: string) => void;
  onTogglePin: (userId: string) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export const UserDropdown: React.FC<UserDropdownProps> = ({
  users,
  pinnedUserIds,
  selectedUserId,
  onUserSelect,
  onTogglePin,
  onClose,
  triggerRef
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Calculate position to avoid overflow and handle fixed positioning
  useEffect(() => {
    const calculatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const dropdownWidth = 288; // w-72 = 18rem = 288px
      const windowWidth = window.innerWidth;

      // Position below the trigger button
      let left = triggerRect.left;

      // Adjust if would overflow right edge
      if (left + dropdownWidth > windowWidth - 20) {
        left = windowWidth - dropdownWidth - 20;
      }

      setPosition({
        top: triggerRect.bottom + 8, // mt-2 = 8px
        left
      });
    };

    calculatePosition();

    // Recalculate on window resize/scroll
    window.addEventListener('resize', calculatePosition);
    window.addEventListener('scroll', calculatePosition, true);

    return () => {
      window.removeEventListener('resize', calculatePosition);
      window.removeEventListener('scroll', calculatePosition, true);
    };
  }, [triggerRef]);

  // Helper to get display name with fallback chain
  const getDisplayName = (user: User): string => {
    return user.display_name || user.username || user.short_id || user.id.slice(0, 8);
  };

  // Helper to get secondary identifier
  const getSecondaryId = (user: User): string | null => {
    if (user.username && user.short_id) {
      return user.short_id;
    }
    if (!user.username && !user.short_id) {
      return user.id.slice(0, 8);
    }
    return null;
  };

  return (
    <div
      ref={dropdownRef}
      className="fixed w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-[9999] max-h-96 overflow-y-auto"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      data-testid="user-dropdown"
      data-user-dropdown="true"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="text-sm font-medium text-gray-900">
          其他用户 ({users.length})
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>

      {/* User list */}
      <div className="py-2">
        {users.map(user => {
          const isPinned = pinnedUserIds.includes(user.id);
          const displayName = getDisplayName(user);
          const secondaryId = getSecondaryId(user);

          return (
            <div
              key={user.id}
              className={`
                px-4 py-2 hover:bg-gray-50 cursor-pointer flex items-center gap-3
                ${selectedUserId === user.id ? 'bg-blue-50' : ''}
              `}
              onClick={() => onUserSelect(user.id)}
            >
              {/* Avatar */}
              <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                {displayName.slice(0, 2).toUpperCase()}
              </div>

              {/* User info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate" title={user.id}>
                  {displayName}
                </div>
                <div className="text-xs text-gray-500">
                  {secondaryId ? `${secondaryId} · ` : ''}{user.session_count} 次训练
                </div>
              </div>

              {/* Actions */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(user.id);
                }}
                className={`p-1.5 rounded transition-colors ${
                  isPinned
                    ? 'text-star-accent bg-star-accent/10 hover:bg-star-accent/20'
                    : 'text-gray-400 hover:text-star-accent hover:bg-blue-50'
                }`}
                title={isPinned ? '取消置顶' : '置顶用户'}
              >
                {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
              </button>
            </div>
          );
        })}

        {users.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            暂无其他用户
          </div>
        )}
      </div>
    </div>
  );
};
