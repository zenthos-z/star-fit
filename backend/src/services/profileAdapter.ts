/**
 * Profile Adapter - 用户画像数据适配层
 *
 * 解决 user_insights 表中 tags_json 和 red_flags 字段的映射问题
 * MAS 系统使用 tags_json，userProfileService 使用 red_flags
 * 此适配器负责两者之间的转换
 */

export interface TagsMapping {
  tags: string[];
  redFlags: string[];
}

export const ProfileAdapter = {
  tagsToRedFlags(tags: string[]): string[] {
    if (!Array.isArray(tags)) return [];
    return tags.filter(tag => {
      return tag.includes('pain') || 
             tag.includes('injury') || 
             tag.includes('risk') ||
             tag.startsWith('red_flag:');
    });
  },

  redFlagsToTags(redFlags: string[]): string[] {
    if (!Array.isArray(redFlags)) return [];
    return redFlags.map(flag => `red_flag:${flag}`);
  },

  normalizeTagsFromInsight(insight: any): { tags: string[]; redFlags: string[] } {
    const tags = Array.isArray(insight?.tags) ? insight.tags : [];
    const redFlags = Array.isArray(insight?.red_flags) ? insight.red_flags : [];
    return { tags, redFlags };
  },

  mergeTagsAndRedFlags(tags: string[], redFlags: string[]): string[] {
    const merged = new Set([...tags]);
    redFlags.forEach(flag => merged.add(`red_flag:${flag}`));
    return Array.from(merged);
  }
};
