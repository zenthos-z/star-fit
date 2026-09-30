/**
 * 插件注册 API —— register(cardType, component, spec)（issue #88 分册3）
 *
 * 把「上新卡片 = 改框架源码（ExerciseRenderer 硬编码 PluginRegistry）」
 * 变成「上新卡片 = 注册调用」：
 *
 *   - 编译时注册先行：现有卡片在装配文件（assembleCards.ts）逐一 register，
 *     注册表 = 模块级显式装配；ExerciseRenderer 分发链只消费本注册表
 *   - 注册时 spec 自动校验：与 shared/contracts 契约对拍（validateCardSpec），
 *     不一致装配即抛错（启动即红，坏 spec 不许进运行时）
 *   - 不兜底（红线2）：未注册 cardType 分发 = 显式错误（resolveCard
 *     返回 undefined，渲染层出可见错误卡 + 开发态告警指向「去注册」），
 *     禁静默 fallback 到 StandardCard
 *   - 运行时留口：registerRemote 接口预留、本批不实现网络加载
 *
 * @see assembleCards.ts 装配文件（现有卡片全量注册的唯一处）
 * @see cardSpec.ts spec 形态与真源对拍
 * @created 2026-10-01
 */

import type { FC, LazyExoticComponent } from 'react';
import type { CardSpec } from './cardSpec';
import { actionTypeToCardType, validateCardSpec } from './cardSpec';

/** 注册组件类型：函数组件或 React.lazy 产物（懒加载卡） */
export type CardComponent = FC<any> | LazyExoticComponent<any>;

/** 一条注册记录 */
export interface RegisteredCard {
  readonly cardType: string;
  readonly component: CardComponent;
  readonly spec: CardSpec;
}

/** 注册表（模块级；装配文件是唯一写入方 + 测试的 fresh 实例） */
const registry = new Map<string, RegisteredCard>();

/** 注册错误（启动即抛，带修复指引） */
export class CardRegistrationError extends Error {
  constructor(cardType: string, detail: string) {
    super(`[cardRegistry] 注册失败 "${cardType}"：${detail}`);
    this.name = 'CardRegistrationError';
  }
}

function isComponentLike(component: unknown): boolean {
  // React.FC / memo / forwardRef 是函数；React.lazy 产物是带 $$typeof 的对象
  return (
    typeof component === 'function' ||
    (typeof component === 'object' && component !== null && '$$typeof' in component)
  );
}

/**
 * 注册一张卡片。
 *
 * @param cardType 分发键——运动卡 `{major}_{variant}`（真源枚举）、
 *                 AI 卡（AI_CARD_TYPES）、哨兵键；域外值抛错
 * @param component 渲染组件（ExerciseRenderer 透传 exercise/uiHint/onUpdate/
 *                  onConfirm/addAttachment 等全套 props）
 * @param spec      卡片规范卡结构化摘要（与 shared/contracts 契约自动对拍）
 * @throws CardRegistrationError cardType 域外 / 重复注册 / spec 契约不符 /
 *                               component 非组件
 */
export function register(
  cardType: string,
  component: CardComponent,
  spec: CardSpec,
): void {
  if (registry.has(cardType)) {
    throw new CardRegistrationError(
      cardType,
      `重复注册（已注册组件不覆盖——换卡请改装配文件里该键的注册，禁双写）`,
    );
  }
  if (!isComponentLike(component)) {
    throw new CardRegistrationError(
      cardType,
      `component 必须是 React 组件（函数组件 / memo / lazy），当前: ${typeof component}`,
    );
  }
  const problems = validateCardSpec(cardType, spec);
  if (problems.length > 0) {
    throw new CardRegistrationError(cardType, problems.join('；'));
  }
  registry.set(cardType, { cardType, component, spec });
}

/**
 * 解析分发键 → 注册记录。
 *
 * 解析顺序：
 *   1. 注册表精确命中（装配注册的标准键 / 别名键 / AI 卡键 / 哨兵键）
 *   2. 未命中且输入是动作类型裸值（细类 / hiit / 存量旧值）→ 按真源映射
 *      派生标准卡键再查（cardSpec.actionTypeToCardType，唯一映射禁第二套）
 *
 * @returns 未注册 = undefined（调用方显式报错，禁静默兜底——红线2）
 */
export function resolveCard(rawKey: string | undefined): RegisteredCard | undefined {
  if (!rawKey) return undefined;
  const direct = registry.get(rawKey);
  if (direct) return direct;
  // 协议两层哨兵：ExerciseAction.type 用大写 'UNKNOWN'，UIHint 用小写 'unknown'
  // ——同一概念（未知占位卡），归一到已注册的小写哨兵键
  if (rawKey === 'UNKNOWN') return registry.get('unknown');
  const derived = actionTypeToCardType(rawKey);
  return derived ? registry.get(derived) : undefined;
}

/** 已注册键清单（注册表卡片清单 / 测试断言用） */
export function getRegisteredCardTypes(): string[] {
  return [...registry.keys()];
}

/** 取某键的注册 spec（无注册返回 undefined） */
export function getCardSpec(cardType: string): CardSpec | undefined {
  return registry.get(cardType)?.spec;
}

// ============================================================================
// 运行时插件留口（接口预留，本批不实现网络加载）
// ============================================================================

/** 远程卡片模块形态（运行时插件的载荷面——占位声明） */
export interface RemoteCardModule {
  cardType: string;
  component: CardComponent;
  spec: CardSpec;
}

/**
 * 运行时远程插件加载（预留接口，#88 分册3 明确本批不实现）。
 * 编译时注册（assembleCards.ts）是当前唯一装配通道。
 */
export async function registerRemote(_source: string | URL): Promise<never> {
  void _source;
  throw new Error(
    `[cardRegistry] registerRemote 未实现（#88 分册3 预留接口）——当前仅支持编译时注册：` +
      `register(cardType, component, spec)，装配文件 src/components/execution/registry/assembleCards.ts`,
  );
}
