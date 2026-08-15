import { SessionRepo } from './sessionRepo.js';
import { ExportOptionsSchema, type ExportOptions } from '../schemas/exportSchema.js';
import { getPostgresClient } from '../db/index.js';

interface TrainingStats {
  totalSessions: number;
  totalDuration: number; // in seconds
  totalVolume: number; // in kg
  avgRPE: number;
  highIntensitySets: number; // RPE >= 8
}

interface SessionWithDetails {
  id: string;
  start_time: number;
  duration: number;
  title: string;
  raw_json: string;
}

/**
 * Markdown Export Service
 * Generates Markdown reports from user training sessions
 */
export const markdownExportService = {
  /**
   * Main entry point for generating markdown export
   * @param options - Export options including userId and date range
   * @returns Object containing markdown content and metadata
   */
  async generateMarkdownExport(options: ExportOptions) {
    // Validate input
    const validated = ExportOptionsSchema.parse(options);
    const { userId, startDate, endDate } = validated;

    console.log(`[MarkdownExport] Generating export for user: ${userId}, range: ${startDate} - ${endDate}`);

    // Get all user sessions from SessionRepo (L2 -> L3)
    const sessions = (await SessionRepo.getAllUserSessions(userId)) as SessionWithDetails[];

    // Filter by date range if provided
    const filteredSessions = this.filterSessionsByDate(sessions, startDate, endDate);

    if (filteredSessions.length === 0) {
      console.log(`[MarkdownExport] No sessions found for user: ${userId}`);
      return this.generateEmptyExport(userId, startDate, endDate);
    }

    // Get user info
    const userInfo = await this.getUserInfo(userId);

    // Calculate training statistics
    const stats = this.calculateTrainingStats(filteredSessions);

    // Generate markdown content
    const markdown = this.generateMarkdownContent(filteredSessions, userInfo, stats, startDate, endDate);

    // Build response
    const exportTime = new Date().toISOString();
    return {
      markdown,
      metadata: {
        userId,
        exportTime,
        sessionCount: filteredSessions.length,
        timeRange: {
          start: startDate || undefined,
          end: endDate || undefined,
        },
        protocol_version: '2.0.0',
      },
    };
  },

  /**
   * Filter sessions by date range
   * @param sessions - Array of session rows
   * @param startDate - ISO 8601 start date string
   * @param endDate - ISO 8601 end date string
   * @returns Filtered sessions
   */
  filterSessionsByDate(
    sessions: SessionWithDetails[],
    startDate?: string,
    endDate?: string
  ): SessionWithDetails[] {
    if (!startDate && !endDate) {
      return sessions;
    }

    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate).getTime() : Date.now();

    return sessions.filter((session) => {
      const sessionTime = session.start_time;
      return sessionTime >= start && sessionTime <= end;
    });
  },

  /**
   * Calculate training statistics from sessions
   * @param sessions - Array of session rows
   * @returns Training statistics
   */
  calculateTrainingStats(sessions: SessionWithDetails[]): TrainingStats {
    let totalDuration = 0;
    let totalVolume = 0;
    let totalRPE = 0;
    let rpeCount = 0;
    let highIntensitySets = 0;

    for (const session of sessions) {
      totalDuration += session.duration || 0;

      // Parse raw_json with try-catch (Data contract compliance)
      let sessionData: any;
      try {
        sessionData = session.raw_json ? JSON.parse(session.raw_json) : {};
      } catch (e) {
        console.error(`[MarkdownExport] Failed to parse raw_json for session ${session.id}`, e);
        sessionData = { exercises: [] };
      }

      const exercises = sessionData.exercises || [];

      for (const exercise of exercises) {
        if (Array.isArray(exercise.sets)) {
          for (const set of exercise.sets) {
            if (set.completed) {
              // Calculate volume
              if (typeof set.weight === 'number' && typeof set.reps === 'number') {
                totalVolume += set.weight * set.reps;
              }

              // Calculate RPE
              if (typeof set.rpe === 'number') {
                totalRPE += set.rpe;
                rpeCount++;

                if (set.rpe >= 8) {
                  highIntensitySets++;
                }
              }
            }
          }
        }
      }
    }

    return {
      totalSessions: sessions.length,
      totalDuration,
      totalVolume,
      avgRPE: rpeCount > 0 ? totalRPE / rpeCount : 0,
      highIntensitySets,
    };
  },

  /**
   * Generate markdown content from sessions
   * @param sessions - Array of session rows
   * @param userInfo - User information
   * @param stats - Training statistics
   * @param startDate - Start date string
   * @param endDate - End date string
   * @returns Markdown string
   */
  generateMarkdownContent(
    sessions: SessionWithDetails[],
    userInfo: any,
    stats: TrainingStats,
    startDate?: string,
    endDate?: string
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('# 用户训练记录报告');
    lines.push('');
    lines.push(`**用户ID**: ${userInfo?.id || 'Unknown'}`);
    lines.push(`**导出时间**: ${new Date().toISOString()}`);
    lines.push(`**协议版本**: 2.0.0`);
    lines.push('');

    // Time range
    if (startDate || endDate) {
      lines.push(`**时间范围**: ${startDate || '不限'} ~ ${endDate || '不限'}`);
    }
    lines.push(`**训练次数**: ${stats.totalSessions}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Overview stats
    lines.push('## 训练概览');
    lines.push('');
    lines.push('| 指标 | 值 |');
    lines.push('|------|-----|');
    lines.push(`| 总训练次数 | ${stats.totalSessions} |`);
    lines.push(
      `| 总训练时长 | ${Math.floor(stats.totalDuration / 3600)}h ${Math.floor(
        (stats.totalDuration % 3600) / 60
      )}m |`
    );
    lines.push(`| 总训练容量 | ${stats.totalVolume.toLocaleString()} kg |`);
    lines.push(`| 平均RPE | ${stats.avgRPE.toFixed(1)} |`);
    lines.push(`| 高强度组数 (RPE≥8) | ${stats.highIntensitySets} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Session details
    lines.push('## 训练记录');
    lines.push('');

    // Sort sessions by date descending
    const sortedSessions = [...sessions].sort((a, b) => b.start_time - a.start_time);

    // Group by date
    const sessionsByDate = this.groupSessionsByDate(sortedSessions);

    for (const [dateKey, dateSessions] of Object.entries(sessionsByDate)) {
      const date = this.formatDateKey(dateKey);
      lines.push(`### ${date}`);
      lines.push('');

      for (const session of dateSessions as SessionWithDetails[]) {
        this.addSessionToMarkdown(lines, session);
        lines.push('');
      }
    }

    return lines.join('\n');
  },

  /**
   * Add a single session to the markdown output
   * @param lines - Array of markdown lines
   * @param session - Session row
   */
  addSessionToMarkdown(lines: string[], session: SessionWithDetails): void {
    const startTime = new Date(session.start_time);
    const durationMin = session.duration ? Math.floor(session.duration / 60) : 0;

    lines.push(`**训练时间**: ${this.formatTime(startTime)} (${durationMin}分钟)`);
    lines.push(`**训练标题**: ${session.title || '训练'}`);
    lines.push('');

    // Parse raw_json with try-catch
    let sessionData: any;
    try {
      sessionData = session.raw_json ? JSON.parse(session.raw_json) : {};
    } catch (e) {
      console.error(`[MarkdownExport] Failed to parse raw_json for session ${session.id}`, e);
      sessionData = { exercises: [] };
    }

    const exercises = sessionData.exercises || [];

    if (exercises.length > 0) {
      lines.push('#### 动作记录');
      lines.push('');

      let sessionVolume = 0;
      let sessionRPE = 0;
      let sessionRPECount = 0;
      let highIntensitySets = 0;

      exercises.forEach((exercise: any, index: number) => {
        const sets = exercise.sets || [];
        if (sets.length === 0) return;

        lines.push(`##### ${index + 1}. ${exercise.name || '未知动作'}`);

        // Add tags if available
        const tags: string[] = [];
        if (exercise.category) tags.push(exercise.category);
        if (exercise.target) tags.push(exercise.target);
        if (tags.length > 0) {
          lines.push(`*${tags.join(' · ')}*`);
        }

        lines.push('');

        for (const set of sets) {
          if (!set.completed) continue;

          const weight = set.weight || 0;
          const reps = set.reps || 0;
          const rpe = set.rpe || '-';
          const restTime = set.restTime || set.rest_time || '-';

          lines.push(`- 组${sets.indexOf(set) + 1}: ${weight}kg × ${reps}次 RPE${rpe} · 休息${restTime}s`);

          // Stats
          if (typeof weight === 'number' && typeof reps === 'number') {
            sessionVolume += weight * reps;
          }
          if (typeof rpe === 'number') {
            sessionRPE += rpe;
            sessionRPECount++;
            if (rpe >= 8) highIntensitySets++;
          }
        }

        lines.push('');
      });

      // Session summary
      lines.push('**本次小结**');
      lines.push(`- 总容量: ${sessionVolume.toLocaleString()} kg`);
      if (sessionRPECount > 0) {
        lines.push(`- 平均RPE: ${(sessionRPE / sessionRPECount).toFixed(1)}`);
      }
      lines.push(`- 高强度组数 (RPE≥8): ${highIntensitySets}组`);
      lines.push('');
    } else {
      lines.push('*无详细动作记录*');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  },

  /**
   * Group sessions by date
   * @param sessions - Array of session rows
   * @returns Object with date keys and session arrays
   */
  groupSessionsByDate(sessions: SessionWithDetails[]): Record<string, SessionWithDetails[]> {
    const grouped: Record<string, SessionWithDetails[]> = {};

    for (const session of sessions) {
      const date = new Date(session.start_time);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`;

      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(session);
    }

    return grouped;
  },

  /**
   * Format date key for display
   * @param dateKey - Date string in YYYY-MM-DD format
   * @returns Formatted date string with weekday
   */
  formatDateKey(dateKey: string): string {
    const date = new Date(dateKey);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[date.getDay()];

    return `${dateKey} (周${weekday})`;
  },

  /**
   * Format time for display
   * @param date - Date object
   * @returns Formatted time string (HH:MM)
   */
  formatTime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  /**
   * Get user information
   * @param userId - User ID
   * @returns User info object
   */
  async getUserInfo(userId: string): Promise<any> {
    try {
      const client = await getPostgresClient();
      const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      return result.rows[0] || null;
    } catch (e) {
      console.error(`[MarkdownExport] Failed to get user info for ${userId}`, e);
      return null;
    }
  },

  /**
   * Generate empty export when no sessions found
   * @param userId - User ID
   * @param startDate - Start date string
   * @param endDate - End date string
   * @returns Empty export object
   */
  generateEmptyExport(userId: string, startDate?: string, endDate?: string) {
    const exportTime = new Date().toISOString();
    const lines: string[] = [];

    lines.push('# 用户训练记录报告');
    lines.push('');
    lines.push(`**用户ID**: ${userId}`);
    lines.push(`**导出时间**: ${exportTime}`);
    lines.push(`**协议版本**: 2.0.0`);
    lines.push('');

    if (startDate || endDate) {
      lines.push(`**时间范围**: ${startDate || '不限'} ~ ${endDate || '不限'}`);
    }
    lines.push('**训练次数**: 0');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*未找到符合条件的训练记录*');

    return {
      markdown: lines.join('\n'),
      metadata: {
        userId,
        exportTime,
        sessionCount: 0,
        timeRange: {
          start: startDate || undefined,
          end: endDate || undefined,
        },
        protocol_version: '2.0.0',
      },
    };
  },
};
