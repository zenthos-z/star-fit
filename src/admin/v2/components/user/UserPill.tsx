/**
 * User Pill Component
 *
 * A small pill-shaped button representing a user in the selector bar.
 * Shows user display name, online status, and pin indicator.
 *
 * Display priority: username > short_id > UUID prefix
 *
 * @module UserPill
 */

import React from 'react';
import { Pin, User as UserIcon } from 'lucide-react';

interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

interface UserPillProps {
  user: User;
  selected: boolean;
  pinned: boolean;
  onClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
}

export const UserPill: React.FC<UserPillProps> = ({
  user,
  selected,
  pinned,
  onClick,
  onTogglePin
}) => {
  // Use display_name with fallback chain: username > short_id > UUID prefix
  const displayName = user.display_name || user.username || user.short_id || user.id.slice(0, 8);

  // Secondary identifier (shown if username exists)
  const secondaryId = user.username && user.short_id ? user.short_id : null;

  // Get a consistent color based on user ID
  const getAvatarColor = (id: string) => {
    const colors = [
      'bg-blue-100 text-blue-600',
      'bg-green-100 text-green-600',
      'bg-purple-100 text-purple-600',
      'bg-orange-100 text-orange-600',
      'bg-pink-100 text-pink-600',
      'bg-indigo-100 text-indigo-600',
    ];
    const index = parseInt(id.slice(-1), 16) % colors.length;
    return colors[index] || colors[0];
  };

  const avatarColor = getAvatarColor(user.id);

  // Determine online status based on recent activity
  // Consider user "online" if they have a session in the last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isOnline = user.created_at > sevenDaysAgo || user.session_count > 0;

  // Avatar letter: first char of display name
  const avatarLetter = displayName.charAt(0).toUpperCase();

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          flex items-center gap-3 pl-1.5 pr-4 py-1.5 rounded-xl border transition-all duration-200
          ${selected
            ? 'bg-blue-50/50 border-star-accent shadow-sm ring-1 ring-star-accent/20'
            : 'bg-white border-gray-100 hover:border-gray-300 hover:bg-gray-50'
          }
        `}
        title={`用户 ID: ${user.id}${user.username ? `\n用户名: ${user.username}` : ''}${user.short_id ? `\nShort ID: ${user.short_id}` : ''}`}
        data-testid={`user-pill-${user.id}`}
      >
        {/* Avatar Circle */}
        <div className={`
          w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shadow-sm
          ${avatarColor}
        `}>
          {avatarLetter}
        </div>

        {/* User Info */}
        <div className="flex flex-col items-start">
          <span className={`text-sm font-medium leading-none mb-0.5 ${selected ? 'text-gray-900' : 'text-gray-700'}`}>
            {displayName}
          </span>
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-[10px] text-gray-500 leading-none">
              {secondaryId ? `${secondaryId} · ` : ''}{isOnline ? '活跃' : '离线'}
            </span>
          </div>
        </div>
      </button>

    </div>
  );
};
