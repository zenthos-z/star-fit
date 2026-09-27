/**
 * MuscleMapSvg 单测：36 肌群词表全覆盖 + primary/secondary 数据驱动高亮
 */

import React from 'react';
import { render } from '@testing-library/react';
import { MUSCLEMAP_SLUGS, MUSCLE_PRIMARY_COLOR, MUSCLE_SECONDARY_COLOR, type MuscleMapSlug } from '../../lib/muscleMap';
import { MALE_FRONT_PATHS } from '../musclemap/paths/male-front-paths';
import { MALE_BACK_PATHS } from '../musclemap/paths/male-back-paths';
import { MuscleMapSvg } from '../execution/MuscleMapSvg';

describe('MuscleMapSvg · Web 版肌群人体图（v5）', () => {
  it('front/back 双视图渲染原包几何数据（34/36 有形；rotator-cuff/rhomboids 包内无 path）', () => {
    const { container } = render(<MuscleMapSvg primary={[]} secondary={[]} />);
    // 有独立几何的 slug 必须渲染出 path；子群（rear-deltoid/upper|lower-trapezius
    // 等）无独立节点，高亮经父群生效（见继承用例）；rotator-cuff/rhomboids 包内
    // 无几何（原生渲染亦不绘制），为已知例外
    const ownEntrySlugs = new Set(
      [...MALE_FRONT_PATHS, ...MALE_BACK_PATHS].map(e => e.slug),
    );
    for (const slug of MUSCLEMAP_SLUGS) {
      const nodes = container.querySelectorAll(`[data-slug="${slug}"]`);
      if (ownEntrySlugs.has(slug)) {
        expect(nodes.length).toBeGreaterThan(0);
      } else {
        expect(nodes.length).toBe(0);
      }
    }
    expect(MUSCLEMAP_SLUGS).toHaveLength(36);
  });

  it('primary 肌群以强调色高饱和填充', () => {
    const primary: MuscleMapSlug[] = ['chest'];
    const { container } = render(<MuscleMapSvg primary={primary} secondary={[]} />);
    const chest = container.querySelectorAll('[data-slug="chest"]');
    chest.forEach(n => expect(n.getAttribute('fill')).toBe(MUSCLE_PRIMARY_COLOR));
  });

  it('secondary 肌群以同色低饱和填充', () => {
    const { container } = render(<MuscleMapSvg primary={[]} secondary={['biceps']} />);
    container.querySelectorAll('[data-slug="biceps"]').forEach(n => {
      expect(n.getAttribute('fill')).toBe(MUSCLE_SECONDARY_COLOR);
      expect(Number(n.getAttribute('fill-opacity'))).toBeCloseTo(0.55);
    });
  });
});


describe('MuscleMapSvg · 子群继承（原包 Muscle.parentGroup 语义）', () => {
  it('子群高亮（rear-deltoid）着色父群 deltoids 的 path', () => {
    const { container } = render(<MuscleMapSvg primary={['rear-deltoid']} secondary={[]} />);
    container.querySelectorAll('[data-slug="deltoids"]').forEach(n => {
      expect(n.getAttribute('fill')).toBe(MUSCLE_PRIMARY_COLOR);
    });
  });

  it('子群高亮（upper-trapezius）着色父群 trapezius 的 path', () => {
    const { container } = render(<MuscleMapSvg primary={['upper-trapezius']} secondary={[]} />);
    container.querySelectorAll('[data-slug="trapezius"]').forEach(n => {
      expect(n.getAttribute('fill')).toBe(MUSCLE_PRIMARY_COLOR);
    });
  });
});
