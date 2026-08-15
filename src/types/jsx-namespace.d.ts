/**
 * React 19 的 @types/react 把 JSX 命名空间移到了 declare namespace React 内部，
 * 不再是顶层全局命名空间。使用 react-jsx 编译模式的代码中，一些文件直接引用
 * JSX.Element / JSX.IntrinsicElements 等类型，需全局桥接。
 *
 * @see node_modules/@types/react/index.d.ts:4090
 */
import React from 'react';

declare global {
  namespace JSX {
    type ElementType = React.JSX.ElementType;
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }
}
