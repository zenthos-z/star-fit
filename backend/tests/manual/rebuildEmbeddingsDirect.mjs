/**
 * 直接重建所有动作的 Embedding
 * 使用 API 生成 embedding，然后直接更新数据库
 */

import 'dotenv/config';
import { Pool } from 'pg';

const EMBEDDING_API = 'https://www.dmxapi.cn/v1/embeddings';
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error('OPENAI_API_KEY not found');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 辅助函数：提取 HTML 纯文本
function extractTextFromHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 辅助函数：格式化器械
function formatEquipment(equipment) {
  if (!equipment || equipment.length === 0) return '无需任何器械';
  if (equipment.length === 1) return `需要${equipment[0]}`;
  return `需要${equipment.join('、')}`;
}

// 辅助函数：格式化运动模式
function formatPattern(pattern) {
  const patternMap = {
    push: '推类动作',
    pull: '拉类动作',
    hinge: '铰链动作（如硬拉）',
    squat: '蹲类动作',
    lunge: '箭步蹲类动作',
    stabilize: '稳定类动作',
    flexion: '屈曲类动作'
  };
  return patternMap[pattern] || pattern || '';
}

// 辅助函数：格式化目标肌群
function formatTargets(targets) {
  if (!targets) return '';
  const parts = [];
  if (targets.primary && Array.isArray(targets.primary)) {
    parts.push(`主要锻炼${targets.primary.join('、')}`);
  }
  if (targets.secondary && Array.isArray(targets.secondary)) {
    parts.push(`次要锻炼${targets.secondary.join('、')}`);
  }
  return parts.join('，');
}

// 构建 embedding 文本
function buildEmbeddingText(exercise) {
  const { name, attributes, content_html } = exercise;
  const parts = [];

  parts.push(`动作名称：${name}`);

  if (attributes) {
    const pattern = formatPattern(attributes.pattern);
    if (pattern) parts.push(`运动模式：${pattern}`);

    const targets = formatTargets(attributes.targets);
    if (targets) parts.push(`目标肌群：${targets}`);

    const equipment = formatEquipment(attributes.equipment_required);
    parts.push(`器械要求：${equipment}`);

    if (attributes.difficulty) {
      const difficultyMap = { beginner: '初级', intermediate: '中级', advanced: '高级' };
      parts.push(`难度：${difficultyMap[attributes.difficulty] || attributes.difficulty}`);
    }

    // 如果 attributes 中有 description，添加它
    if (attributes.description) {
      parts.push(`动作描述：${attributes.description}`);
    }
  }

  // 教程内容（这是关键！）
  if (content_html) {
    const plainText = extractTextFromHtml(content_html);
    if (plainText.length > 0) {
      const maxLength = 2000;
      const truncated = plainText.length > maxLength
        ? plainText.substring(0, maxLength) + '...'
        : plainText;
      parts.push(`动作教程：${truncated}`);
    }
  }

  return parts.join('\n');
}

// 调用 Embedding API
async function generateEmbedding(text) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`  重试 ${attempt}/${maxRetries}...`);
      }

      const response = await fetch(EMBEDDING_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
          dimensions: 1536
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      if (!data.data || data.data.length === 0) {
        throw new Error('No embedding returned');
      }

      return data.data[0].embedding;

    } catch (error) {
      const isNetworkError =
        error.name === 'AbortError' ||
        error.message.includes('fetch failed') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT');

      if (!isNetworkError || attempt >= maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`  等待 ${delay}ms 后重试...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error('Failed to generate embedding');
}

// 保存 embedding 到数据库
async function saveEmbedding(exerciseId, embedding) {
  const embeddingArray = `[${embedding.join(',')}]`;
  await pool.query(
    `UPDATE exercises SET embedding = $1::vector(1536) WHERE id = $2`,
    [embeddingArray, exerciseId]
  );
}

// 主函数
async function rebuildAllEmbeddings() {
  console.log('========================================');
  console.log('重建所有动作的 Embedding（包含教程）');
  console.log('========================================\n');

  try {
    // 获取所有动作
    const result = await pool.query(`
      SELECT
        id,
        name,
        attributes,
        content_html
      FROM exercises
      ORDER BY name
    `);

    console.log(`找到 ${result.rows.length} 个动作\n`);

    let successCount = 0;
    let failCount = 0;

    for (const exercise of result.rows) {
      const { id, name } = exercise;

      try {
        console.log(`处理: ${name} (${id})`);

        // 构建 embedding 文本（包含教程！）
        const text = buildEmbeddingText(exercise);
        const tutorialLength = exercise.content_html ? exercise.content_html.length : 0;
        console.log(`  文本长度: ${text.length} 字符 (教程: ${tutorialLength} 字符)`);

        // 生成 embedding
        const embedding = await generateEmbedding(text);
        console.log(`  Embedding: ${embedding.length} 维`);

        // 保存到数据库
        await saveEmbedding(id, embedding);
        console.log(`  ✓ 成功\n`);

        successCount++;

        // 避免过快请求
        await new Promise(r => setTimeout(r, 500));

      } catch (error) {
        console.log(`  ✗ 失败: ${error.message}\n`);
        failCount++;
      }
    }

    console.log('========================================');
    console.log('重建完成');
    console.log('========================================');
    console.log(`总计: ${result.rows.length}`);
    console.log(`成功: ${successCount}`);
    console.log(`失败: ${failCount}`);

    if (failCount === 0) {
      console.log('\n所有动作的 embedding 已成功重建！');
      console.log('现在向量搜索应该能正常工作了。');
    }

  } catch (error) {
    console.error('重建失败:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

rebuildAllEmbeddings().catch(console.error);
