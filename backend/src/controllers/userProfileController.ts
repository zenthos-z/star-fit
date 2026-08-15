/**
 * User Profile Controller - 用户画像 API
 *
 * 提供：
 * - GET /api/profiles/:userId - 获取用户画像
 * - PUT /api/profiles/:userId - 更新用户画像
 * - DELETE /api/profiles/:userId/anchors/:exerciseId - 删除特定负荷锚点
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { UserProfileService, parseLoadAnchors } from '../services/userProfileService.js';
import type { LoadAnchors } from '../services/userProfileService.js';
import { parseJSONSafe } from '../types/validation.js';
import { getNowISO } from '../utils/timestamp.js';

// ============================================
// Handlers
// ============================================

/**
 * 获取用户画像
 */
export async function getUserProfile(
  request: FastifyRequest<{ Params: { userId: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId } = request.params;

    const profile = await UserProfileService.getProfile(userId);

    // 解析 JSON 字段（统一处理默认数据和实际数据）
    const baseProfile = profile || {
      user_id: userId,
      fitness_level: 'beginner',
      red_flags: '[]',
      basic_info: '{}',
      preferences: '{}',
      physiological: '{}',
      load_anchors: '{}',
      psychological: '{}',
      training_strategy: null,
      modified_by: 'system',
      updated_at: getNowISO()
    };

    const parsed = {
      ...baseProfile,
      red_flags: parseJSONSafe<string[]>(baseProfile.red_flags, 'getUserProfile red_flags') || [],
      basic_info: parseJSONSafe(baseProfile.basic_info, 'getUserProfile basic_info') || {},
      preferences: parseJSONSafe(baseProfile.preferences, 'getUserProfile preferences') || {},
      physiological: parseJSONSafe(baseProfile.physiological, 'getUserProfile physiological') || {},
      load_anchors: parseLoadAnchors(baseProfile.load_anchors),
      psychological: parseJSONSafe(baseProfile.psychological, 'getUserProfile psychological') || {},
      // training_strategy 直接返回文本，不需要解析
      training_strategy: baseProfile.training_strategy || null
    };

    reply.send(parsed);
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to fetch user profile',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 删除特定负荷锚点
 */
export async function deleteLoadAnchor(
  request: FastifyRequest<{
    Params: { userId: string; exerciseId: string };
    Querystring: { replaceAnchors?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId, exerciseId } = request.params;
    const { replaceAnchors } = request.query;

    console.log('[UserProfile] Deleting load anchor for user:', userId, 'exercise:', exerciseId);

    const profile = await UserProfileService.getProfile(userId);
    if (!profile) {
      reply.status(404).send({ error: 'User profile not found' });
      return;
    }

    const existingAnchors = parseLoadAnchors(profile.load_anchors);

    if (!existingAnchors[exerciseId]) {
      reply.status(404).send({ error: 'Load anchor not found' });
      return;
    }

    const newAnchors = { ...existingAnchors };
    delete newAnchors[exerciseId];

    await UserProfileService.updateProfile({
      userId,
      load_anchors: newAnchors,
      modifiedBy: 'admin',
      changeReason: `Deleted load anchor for ${exerciseId}`,
      replaceAnchors: replaceAnchors === 'true'
    });

    reply.send({
      message: 'Load anchor deleted successfully',
      userId,
      exerciseId
    });
  } catch (error) {
    console.error('[UserProfile] Delete anchor error:', error);
    reply.status(500).send({
      error: 'Failed to delete load anchor',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 更新用户画像
 */
export async function updateUserProfile(
  request: FastifyRequest<{
    Params: { userId: string };
    Body: {
      basic_info?: object;
      preferences?: object;
      physiological?: object;
      load_anchors?: object;
      training_strategy?: string;
      red_flags?: string[];
      fitness_level?: string;
      modifiedBy?: string;
      changeReason?: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId } = request.params;
    const body = request.body;

    console.log('[UserProfile] Updating profile for user:', userId);
    console.log('[UserProfile] Request body:', body);

    const loadAnchors =
      body.load_anchors && typeof body.load_anchors === 'object'
        ? (body.load_anchors as LoadAnchors)
        : undefined;

    const fitnessLevelRaw = body.fitness_level;
    const fitnessLevel =
      fitnessLevelRaw === 'beginner' || fitnessLevelRaw === 'intermediate' || fitnessLevelRaw === 'advanced'
        ? fitnessLevelRaw
        : undefined;

    // 调用服务层更新画像
    await UserProfileService.updateProfile({
      userId,
      basic_info: body.basic_info,
      preferences: body.preferences,
      physiological: body.physiological,
      load_anchors: loadAnchors,
      training_strategy: body.training_strategy,
      red_flags: body.red_flags,
      fitness_level: fitnessLevel,
      modifiedBy: (body.modifiedBy as any) || 'admin',
      changeReason: body.changeReason || 'Admin manual update'
    });

    // 获取更新后的完整数据并返回，让前端可以直接使用
    const updatedProfile = await UserProfileService.getProfile(userId);

    // 解析 JSON 字段（与 getUserProfile 保持一致）
    const baseProfile = updatedProfile || {
      user_id: userId,
      fitness_level: 'beginner',
      red_flags: '[]',
      basic_info: '{}',
      preferences: '{}',
      physiological: '{}',
      load_anchors: '{}',
      psychological: '{}',
      training_strategy: null,
      modified_by: 'system',
      updated_at: getNowISO()
    };

    const parsedProfile = {
      ...baseProfile,
      red_flags: parseJSONSafe<string[]>(baseProfile.red_flags, 'updateUserProfile red_flags') || [],
      basic_info: parseJSONSafe(baseProfile.basic_info, 'updateUserProfile basic_info') || {},
      preferences: parseJSONSafe(baseProfile.preferences, 'updateUserProfile preferences') || {},
      physiological: parseJSONSafe(baseProfile.physiological, 'updateUserProfile physiological') || {},
      load_anchors: parseLoadAnchors(baseProfile.load_anchors),
      psychological: parseJSONSafe(baseProfile.psychological, 'updateUserProfile psychological') || {},
      // training_strategy 直接返回文本，不需要解析
      training_strategy: baseProfile.training_strategy || null
    };

    reply.send({
      message: 'User profile updated successfully',
      userId,
      profile: parsedProfile  // 返回解析后的完整数据
    });
  } catch (error) {
    console.error('[UserProfile] Update error:', error);
    reply.status(500).send({
      error: 'Failed to update user profile',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
