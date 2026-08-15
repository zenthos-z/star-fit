/**
 * User Profile Panel Component
 *
 * Left panel displaying user's physical stats, psychological profile,
 * and load anchors in a light theme.
 *
 * @module UserProfilePanel
 */

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Edit, FileText, Dumbbell, HeartPulse } from 'lucide-react';
import { PhysioStatsSection } from './PhysioStatsSection';
import { PsychologicalSection } from './PsychologicalSection';
import { LoadAnchorsSection } from './LoadAnchorsSection';
import { EditProfileDialog } from './dialogs/EditProfileDialog';
import { ExportMarkdownDialog } from './dialogs/ExportMarkdownDialog';
import { EditTrainingStrategyDialog } from './EditTrainingStrategyDialog';
import { TrainingStrategySection } from './edit-sections/TrainingStrategySection';
import { LoadAnchorsEditor } from './edit-sections/LoadAnchorsEditor';
import { LimitationsEditor } from './edit-sections/LimitationsEditor';
import { AdminService } from '../../services/api';
import type { FlattenedProfile } from '../../services/api';
import { parseJSONSafe } from '../../../../types/validation';
import type {
  LoadAnchors,
  ActiveLimitation,
  BasicInfo,
  Preferences,
  Physiological,
  Psychological
} from 'shared/contracts';

// Use FlattenedProfile from api.ts as the canonical profile type
type AdminUserProfile = FlattenedProfile;

/**
 * User Stats Interface
 * Statistics for the user profile panel
 */
interface UserStats {
  sessionCount?: number;
  totalVolume?: number;
  [key: string]: unknown;
}

interface UserProfilePanelProps {
  userId: string;
  profile: AdminUserProfile | null;
  stats: UserStats | null;
  loading: boolean;
  onStatsUpdate?: (stats: UserStats) => void;
}

export const UserProfilePanel: React.FC<UserProfilePanelProps> = ({
  userId,
  profile,
  stats,
  loading,
  onStatsUpdate
}) => {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [markdownExportOpen, setMarkdownExportOpen] = useState(false);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [localProfile, setLocalProfile] = useState<AdminUserProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // Initialize local profile when profile changes
  useEffect(() => {
    console.log('[UserProfilePanel] Profile received:', profile);
    console.log('[UserProfilePanel] Profile load_anchors:', profile?.load_anchors);
    console.log('[UserProfilePanel] Profile load_anchors type:', typeof profile?.load_anchors);
    if (profile) {
      setLocalProfile(profile);
    }
  }, [profile]);

  const handleEditProfile = async (data: Partial<AdminUserProfile>, options?: { silent?: boolean }) => {
    setSaving(true);
    console.log('[UserProfilePanel] Saving profile:', data);
    console.log('[UserProfilePanel] load_anchors being saved:', data.load_anchors);
    try {
      const response = await AdminService.users.updateProfile(userId, data);
      console.log('[UserProfilePanel] API response:', response);
      console.log('[UserProfilePanel] API response.profile:', response.profile);
      console.log('[UserProfilePanel] API response.profile.load_anchors:', response.profile?.load_anchors);

      // Use the latest data returned from backend
      if (response.profile) {
        const parseData = (item: unknown): Record<string, unknown> | LoadAnchors => {
          if (!item || item === 'null' || item === '') return {} as Record<string, unknown> | LoadAnchors;
          if (typeof item === 'object' && item !== null) return item as Record<string, unknown> | LoadAnchors;
          const parsed = parseJSONSafe(item as string, 'UserProfilePanel parsing');
          return (parsed || {}) as Record<string, unknown> | LoadAnchors;
        };

        const parsedProfile = {
          ...response.profile,
          basic_info: parseData(response.profile.basic_info) as Record<string, unknown>,
          preferences: parseData(response.profile.preferences) as Record<string, unknown>,
          load_anchors: parseData(response.profile.load_anchors) as Record<string, unknown>,
          physiological: parseData(response.profile.physiological) as Record<string, unknown>,
          psychological: parseData(response.profile.psychological) as Record<string, unknown>,
          red_flags: Array.isArray(response.profile.red_flags)
            ? response.profile.red_flags
            : parseJSONSafe(response.profile.red_flags, 'UserProfilePanel red_flags parsing') || []
        };

        console.log('[UserProfilePanel] Parsed profile.load_anchors:', parsedProfile.load_anchors);
        setLocalProfile(parsedProfile as any);

        // Update stats if callback provided (e.g., when training count changes)
        if (onStatsUpdate) {
          const newStats = await AdminService.users.getStats(userId);
          onStatsUpdate(newStats);
        }
      } else {
        // Fallback: use frontend data (cast to full profile type since this is a partial update)
        console.log('[UserProfilePanel] No response.profile, using frontend data');
        setLocalProfile(prev => prev ? { ...prev, ...data } : null);
      }
    } catch (error) {
      console.error('[UserProfilePanel] Failed to update profile:', error);
      // Only show alert if not in silent mode (for dialogs that handle their own errors)
      if (!options?.silent) {
        alert('保存失败: ' + (error as Error).message);
      } else {
        throw error; // Re-throw for dialog to handle
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAnchorUpdate = async (newAnchors: LoadAnchors) => {
    if (!localProfile) return;

    const updatedProfile: Partial<AdminUserProfile> = {
      ...localProfile,
      load_anchors: newAnchors
    };

    await handleEditProfile(updatedProfile);
  };

  const handleTrainingStrategyUpdate = async (strategy: string) => {
    if (!localProfile) return;

    const updatedProfile: Partial<AdminUserProfile> = {
      ...localProfile,
      training_strategy: strategy
    };

    await handleEditProfile(updatedProfile, { silent: true });
  };

  const handleLimitationAdd = async (limitation: Omit<ActiveLimitation, 'logged_at' | 'expire_at'>) => {
    if (!localProfile) return;

    const currentLimitations = localProfile.active_limitations || [];
    // Remove any existing limitation for the same part
    const filteredLimitations = currentLimitations.filter(
      (l: ActiveLimitation) => l.part !== limitation.part
    );

    const updatedProfile: Partial<AdminUserProfile> = {
      ...localProfile,
      active_limitations: [...filteredLimitations, { ...limitation, expire_at: '', logged_at: '' }]
    };

    await handleEditProfile(updatedProfile);
  };

  const handleLimitationRemove = async (part: string) => {
    if (!localProfile) return;

    const currentLimitations = localProfile.active_limitations || [];
    const updatedProfile: Partial<AdminUserProfile> = {
      ...localProfile,
      active_limitations: currentLimitations.filter((l: ActiveLimitation) => l.part !== part)
    };

    await handleEditProfile(updatedProfile);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (!localProfile) {
    return (
      <div className="p-6 text-center text-gray-500">
        加载用户画像失败
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50" data-testid="user-profile-panel">
      {/* Header */}
      <div className="flex-shrink-0 h-[72px] px-6 flex items-center justify-between bg-white border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900">用户画像</h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMarkdownExportOpen(true)}
          >
            <FileText size={14} className="mr-1" />
            生成报告
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
            disabled={saving}
          >
            <Edit size={14} className="mr-1" />
            {saving ? '保存中...' : '编辑资料'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Physiological Stats */}
        <PhysioStatsSection
          basicInfo={localProfile?.basic_info || {}}
          fitnessLevel={localProfile?.fitness_level || 'beginner'}
        />

        {/* Psychological Profile */}
        <PsychologicalSection
          psychological={localProfile?.psychological || {}}
          preferences={localProfile?.preferences || {}}
        />

        {/* Load Anchors - New Editor */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Dumbbell size={18} className="text-star-accent" />
            <h3 className="font-semibold text-gray-900">负荷锚点</h3>
          </div>
          <LoadAnchorsEditor
            loadAnchors={(localProfile?.load_anchors as LoadAnchors) || {}}
            onSave={handleAnchorUpdate}
          />
        </div>

        {/* Active Limitations - New Editor */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <HeartPulse size={18} className="text-red-500" />
            <h3 className="font-semibold text-gray-900">伤病限制</h3>
          </div>
          <LimitationsEditor
            limitations={(localProfile?.active_limitations as ActiveLimitation[]) || []}
            onAdd={handleLimitationAdd}
            onRemove={handleLimitationRemove}
          />
        </div>

        {/* Training Strategy */}
        <TrainingStrategySection
          data={localProfile}
          onEdit={() => setStrategyDialogOpen(true)}
        />
      </div>

      {/* Edit Dialog */}
      {editDialogOpen && (
        <EditProfileDialog
          userId={userId}
          profile={localProfile}
          onSave={async (data) => {
            await handleEditProfile(data as any);
            setEditDialogOpen(false);
          }}
          onClose={() => setEditDialogOpen(false)}
        />
      )}

      <ExportMarkdownDialog
        userId={userId}
        isOpen={markdownExportOpen}
        onClose={() => setMarkdownExportOpen(false)}
      />

      <EditTrainingStrategyDialog
        initialData={localProfile?.training_strategy || null}
        open={strategyDialogOpen}
        onClose={() => setStrategyDialogOpen(false)}
        onSave={handleTrainingStrategyUpdate}
      />
    </div>
  );
};
