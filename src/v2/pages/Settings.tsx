/**
 * Settings Page - User Settings Main Page
 *
 * Main settings page that integrates:
 * - ProfileContainer for basic info and load anchors
 * - LimitationContainer for injury/restriction management
 *
 * @version 2.0.0
 */

import React from 'react';
import { motion } from 'framer-motion';
import { ProfileContainer } from '../components/profile/ProfileContainer';
import { LimitationContainer } from '../components/profile/LimitationContainer';
import { BasicInfoForm } from '../components/profile/BasicInfoForm';
import { LoadAnchorsForm } from '../components/profile/LoadAnchorsForm';
import { LimitationsManager } from '../components/profile/LimitationsManager';
import { staggerContainer, staggerItem } from '../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface SettingsPageProps {
  /** User ID from auth context */
  userId: string;
  /** Callback when user wants to close the settings page */
  onClose?: () => void;
}

// ============================================================================
// Loading & Error Components
// ============================================================================

function LoadingSpinner(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-primary" />
        <p className="mt-4 text-sm text-gray-500">加载中...</p>
      </div>
    </div>
  );
}

function ErrorAlert({ error }: { error: Error }): JSX.Element {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
      <p className="font-semibold">加载失败</p>
      <p className="text-sm">{error.message}</p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SettingsPage({ userId, onClose }: SettingsPageProps): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-star-dark px-4 py-6 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white italic uppercase">
              用户设置
            </h1>
            <p className="text-sm text-white/70 mt-1">
              管理您的个人资料和训练偏好
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="关闭设置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-3xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-6"
        >
          {/* Basic Info Card */}
          <motion.div variants={staggerItem}>
            <ProfileContainer
              userId={userId}
              renderProfileStatic={(data, actions) => (
                <BasicInfoForm
                  data={data}
                  onUpdate={actions.onUpdateStatic}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
            />
          </motion.div>

          {/* Load Anchors Card */}
          <motion.div variants={staggerItem}>
            <ProfileContainer
              userId={userId}
              renderProfileDynamic={(data, actions) => (
                <LoadAnchorsForm
                  anchors={data.load_anchors}
                  onUpdate={async (exerciseId, anchor) => {
                    const currentAnchors = data.load_anchors || {};
                    await actions.onUpdateDynamic({
                      load_anchors: {
                        ...currentAnchors,
                        [exerciseId]: anchor,
                      },
                    });
                  }}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
              renderProfileStatic={undefined as any}
            />
          </motion.div>

          {/* Limitations Card */}
          <motion.div variants={staggerItem}>
            <LimitationContainer
              userId={userId}
              renderLimitations={(limitations, actions) => (
                <LimitationsManager
                  limitations={limitations}
                  onAdd={async (limitation) => {
                    await actions.addLimitation(
                      limitation.part,
                      limitation.severity,
                      (limitation as any).note
                    );
                  }}
                  onRemove={actions.removeLimitation}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
            />
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

export default SettingsPage;
