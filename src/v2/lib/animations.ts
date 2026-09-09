/**
 * @deprecated 兼容转发层：请直接 import 自本路径即可（实际实现见 ./animations/index.ts）。
 *
 * 历史原因：本文件与 animations/ 目录同名并存，TS 模块解析优先命中本文件，
 * 导致全库导入一直走的是这里的旧参数。现改为纯转发，保证全库单一动效真源。
 * （同名文件+目录是解析陷阱，新代码勿再复制此模式。）
 */

export * from './animations/index';

import animations from './animations/index';
export default animations;
