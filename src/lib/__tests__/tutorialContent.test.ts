import { describe, it, expect } from 'vitest';
import {
  parseTutorialsAi,
  pickTutorialContent,
  stripDecorativeEmoji,
} from '../tutorialContent';

describe('pickTutorialContent（库数据优先级）', () => {
  const AI_MD = 'x'.repeat(80);

  it('① content_html（admin 官方版）最高，source=library', () => {
    const picked = pickTutorialContent({
      content_html: '<p>官方内容</p>',
      tutorial_md: '## 动作作用\n\n库内容',
      tutorials: { ai: { content_md: AI_MD } },
    });
    expect(picked).toEqual({ content: '<p>官方内容</p>', source: 'library' });
  });

  it('② tutorial_md（动作库五段组装）次之，source=library', () => {
    const picked = pickTutorialContent({
      content_html: null,
      tutorial_md: '## 动作作用\n\n库内容',
      tutorials: { ai: { content_md: AI_MD } },
    });
    expect(picked).toEqual({ content: '## 动作作用\n\n库内容', source: 'library' });
  });

  it('③ tutorials.ai.content_md 兜底，source=ai', () => {
    const picked = pickTutorialContent({
      content_html: null,
      tutorials: { ai: { content_md: AI_MD } },
    });
    expect(picked).toEqual({ content: AI_MD, source: 'ai' });
  });

  it('三槽皆空 / 过短 AI 内容 → null（调用方走离线备份/AI 生成）', () => {
    expect(pickTutorialContent(null)).toBeNull();
    expect(pickTutorialContent({})).toBeNull();
    expect(pickTutorialContent({ tutorials: { ai: { content_md: '太短' } } })).toBeNull();
    expect(pickTutorialContent({ content_html: '   ', tutorial_md: '' })).toBeNull();
  });

  it('tutorials 为字符串 JSONB 形态亦可解析', () => {
    const picked = pickTutorialContent({
      tutorials: JSON.stringify({ ai: { content_md: AI_MD } }),
    });
    expect(picked?.source).toBe('ai');
  });
});

describe('parseTutorialsAi', () => {
  it('对象/字符串/畸形输入三形态', () => {
    expect(parseTutorialsAi({ ai: { content_md: 'abc' } })).toBe('abc');
    expect(parseTutorialsAi('{"ai":{"content_md":"abc"}}')).toBe('abc');
    expect(parseTutorialsAi('not-json')).toBeUndefined();
    expect(parseTutorialsAi({})).toBeUndefined();
    expect(parseTutorialsAi({ ai: 'nope' })).toBeUndefined();
  });
});

describe('stripDecorativeEmoji（历史 AI 内容清洗，issue #8）', () => {
  it('标题行与引用行去 emoji，正文行不动', () => {
    const md = [
      '# 卧推教程',
      '',
      '## 🎯 动作作用',
      '主要锻炼胸大肌 💪（正文里的保留）',
      '',
      '> ⚠️ 老版提示',
      '',
      '正常段落 ✅ 不清洗',
    ].join('\n');
    const out = stripDecorativeEmoji(md);
    expect(out).toContain('## 动作作用');
    expect(out).toContain('> 老版提示');
    expect(out).toContain('主要锻炼胸大肌 💪');
    expect(out).toContain('正常段落 ✅ 不清洗');
  });

  it('无 emoji 内容原样返回', () => {
    const md = '## 步骤\n\n1. 躺下\n2. 推起';
    expect(stripDecorativeEmoji(md)).toBe(md);
  });
});
