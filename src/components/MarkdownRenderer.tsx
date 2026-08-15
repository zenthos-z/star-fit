/**
 * MarkdownRenderer - 统一的 Markdown 渲染组件
 *
 * 用于：
 * - 后台编辑器预览
 * - 前端 APP 内容显示
 *
 * 支持的语法：
 * - 标准 Markdown：标题、列表、粗体、斜体、引用、代码块
 * - 视频：@[video](url)（将渲染为链接）
 * - 图片：标准 ![alt](url)
 * - HTML：内联 HTML 标签（用于视频等）
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isMobile?: boolean; // 是否为移动端预览（影响样式）
  onImageClick?: (url: string) => void;
}

// 预处理：将 @[video](url) 转换为链接（禁止注入 <video>/<source>/<track>）
const preprocessVideoSyntax = (markdown: string): string => {
  return markdown.replace(
    /@\[video\]\(([^)]+)\)/gi,
    (match, url) => {
      // 检查是否是相对路径
      const fullUrl = url.startsWith('http') || url.startsWith('/uploads/')
        ? url
        : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;

      return `[视频资源](${fullUrl})`;
    }
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  isMobile = false,
  onImageClick
}) => {
  // 预处理：转换视频语法
  const preprocessed = preprocessVideoSyntax(content || '');

  // 使用 ReactMarkdown 渲染
  const rendered = (
    <ReactMarkdown
      className={className}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        video: ({ node, ...props }) => null,
        source: ({ node, ...props }) => null,
        track: ({ node, ...props }) => null,
        // 自定义图片渲染
        img: ({ node, ...props }) => {
          const src = props.src || '';
          const fullSrc = src.startsWith('http') || src.startsWith('/uploads/')
            ? src
            : `${window.location.origin}${src.startsWith('/') ? '' : '/'}${src}`;

          return (
            <img
              {...props}
              src={fullSrc}
              className={`rounded-lg max-w-full h-auto my-4 transition-all ${onImageClick ? 'cursor-pointer active:opacity-80' : ''}`}
              alt={props.alt}
              loading="lazy"
              onClick={() => onImageClick?.(fullSrc)}
            />
          );
        },
        // 自定义链接渲染
        a: ({ node, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800"
          />
        ),
      }}
    >
      {preprocessed}
    </ReactMarkdown>
  );

  return rendered;
};

// 导出纯函数版本（用于服务器端或非 React 环境）
export const renderMarkdown = (markdown: string, options?: { isMobile?: boolean }): string => {
  // 这个函数主要用于服务器端或需要纯 HTML 输出的场景
  // 客户端应该使用 MarkdownRenderer 组件
  return preprocessVideoSyntax(markdown || '');
};

export default MarkdownRenderer;
