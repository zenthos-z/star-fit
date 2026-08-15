/**
 * TipTapMarkdownEditor - Typora 风格的 Markdown 编辑器
 *
 * 特性：
 * - 所见即所得的 Markdown 编辑体验
 * - 支持 Markdown 语法快捷输入（# 标题，**粗体**，- 列表等）
 * - 自动隐藏 Markdown 源码，显示格式化内容
 * - 支持代码高亮
 * - 支持视频上传和嵌入
 * - 移动端实时预览
 */

import React, { useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { common, createLowlight } from 'lowlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';

import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiCode,
  FiList,
  FiAlignLeft,
  FiAlignCenter,
  FiAlignRight,
  FiImage,
  FiRotateCcw,
  FiRotateCw,
  FiType,
} from 'react-icons/fi';
import { BsBlockquoteLeft, BsListOl } from 'react-icons/bs';
import { LuHeading1, LuHeading2, LuHeading3 } from 'react-icons/lu';

import './TipTapMarkdownEditor.css';

interface TipTapMarkdownEditorProps {
  content: string;
  onChange: (content: string, markdown: string) => void;
}

export const TipTapMarkdownEditor: React.FC<TipTapMarkdownEditorProps> = ({
  content,
  onChange,
}) => {

  // 创建 lowlight 实例
  const lowlight = createLowlight(common);

  // 扩展配置
  const extensions = useMemo(() => [
    StarterKit.configure({
      codeBlock: false, // 使用 CodeBlockLowlight 代替
    }),
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') {
          return '标题...';
        }
        return '输入 / 选择命令，或直接使用 Markdown 语法...';
      },
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
    }),
    Markdown.configure({}),
  ], []);

  // 编辑器初始化
  const editor = useEditor({
    extensions,
    content: content || '',
    editorProps: {
      attributes: {
        class: 'tiptap-markdown-editor prose prose-sm max-w-none focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const markdown = (editor as any).getMarkdown();
      onChange(html, markdown || '');
    },
  }, []);

  // 工具栏按钮组件
  const ToolbarButton: React.FC<{
    icon: React.ReactNode;
    title: string;
    onClick: () => void;
    isActive?: boolean;
  }> = ({ icon, title, onClick, isActive }) => (
    <button
      onClick={onClick}
      className={`p-2 rounded transition-colors ${
        isActive ? 'bg-blue-500 text-white' : 'hover:bg-gray-700 text-gray-300'
      }`}
      title={title}
    >
      {icon}
    </button>
  );

  if (!editor) {
    return <div className="p-4 text-gray-400">加载编辑器...</div>;
  }

  const currentMarkdown = (editor as any).getMarkdown?.() || content;

  return (
    <div className="tiptap-markdown-container">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 p-3 border-b border-gray-700 bg-gray-800/50 flex-wrap">
        {/* 撤销/重做 */}
        <ToolbarButton
          icon={<FiRotateCcw size={16} />}
          title="撤销"
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon={<FiRotateCw size={16} />}
          title="重做"
          onClick={() => editor.chain().focus().redo().run()}
        />

        <div className="w-[1px] h-5 bg-gray-600 mx-2" />

        {/* 标题 */}
        <ToolbarButton
          icon={<LuHeading1 size={16} />}
          title="一级标题"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
        />
        <ToolbarButton
          icon={<LuHeading2 size={16} />}
          title="二级标题"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
        />
        <ToolbarButton
          icon={<LuHeading3 size={16} />}
          title="三级标题"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
        />

        <div className="w-[1px] h-5 bg-gray-600 mx-2" />

        {/* 文本格式 */}
        <ToolbarButton
          icon={<FiBold size={16} />}
          title="粗体"
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
        />
        <ToolbarButton
          icon={<FiItalic size={16} />}
          title="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
        />
        <ToolbarButton
          icon={<FiUnderline size={16} />}
          title="下划线"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
        />
        <ToolbarButton
          icon={<FiCode size={16} />}
          title="行内代码"
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
        />

        <div className="w-[1px] h-5 bg-gray-600 mx-2" />

        {/* 列表 */}
        <ToolbarButton
          icon={<FiList size={16} />}
          title="无序列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
        />
        <ToolbarButton
          icon={<BsListOl size={16} />}
          title="有序列表"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
        />
        <ToolbarButton
          icon={<BsBlockquoteLeft size={16} />}
          title="引用"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
        />

        <div className="w-[1px] h-5 bg-gray-600 mx-2" />

        {/* 对齐 */}
        <ToolbarButton
          icon={<FiAlignLeft size={16} />}
          title="左对齐"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
        />
        <ToolbarButton
          icon={<FiAlignCenter size={16} />}
          title="居中"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
        />
        <ToolbarButton
          icon={<FiAlignRight size={16} />}
          title="右对齐"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
        />

        <div className="w-[1px] h-5 bg-gray-600 mx-2" />

        {/* 媒体 */}
        <ToolbarButton
          icon={<FiImage size={16} />}
          title="插入图片"
          onClick={() => {
            const url = window.prompt('输入图片URL:');
            if (url) editor.chain().focus().insertContent(`<img src="${url}" alt="">`).run();
          }}
        />
      </div>

      {/* 编辑区域 */}
      <div className="flex">
        {/* 左侧：编辑器 */}
        <div className="flex-1 min-w-0">
          <EditorContent editor={editor} className="tiptap-markdown-editor" />
        </div>

        {/* 右侧：移动端预览 */}
        <div className="w-[375px] flex-shrink-0 border-l border-gray-700 bg-gray-900 overflow-y-auto max-h-[600px]">
          {/* 手机框架 */}
          <div className="sticky top-0">
            {/* 状态栏 */}
            <div className="h-7 bg-black text-white text-xs flex items-center justify-between px-4">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                <span>📶</span>
                <span>🔋</span>
              </div>
            </div>

            {/* 刘海 */}
            <div className="h-6 bg-black flex justify-center">
              <div className="w-32 h-4 bg-black rounded-b-xl" />
            </div>

            {/* 内容区域 */}
            <div className="p-4 bg-white min-h-[500px]">
              <div className="markdown-content mobile-preview">
                <MarkdownRenderer
                  content={currentMarkdown}
                  isMobile={true}
                />
              </div>
            </div>

            {/* 底部指示条 */}
            <div className="h-5 bg-white flex justify-center items-center">
              <div className="w-32 h-1 bg-black rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Markdown 源码查看（可选） */}
      <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300">Markdown 源码</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(currentMarkdown);
            }}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            复制 Markdown
          </button>
        </div>
        <pre className="text-xs text-gray-400 bg-gray-900 p-3 rounded overflow-x-auto max-h-40 overflow-y-auto">
          {currentMarkdown}
        </pre>
      </div>
    </div>
  );
};

export default TipTapMarkdownEditor;
