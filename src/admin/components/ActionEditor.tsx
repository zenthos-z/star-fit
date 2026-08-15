import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import DOMPurify from 'dompurify';
import {
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3,
  Image as ImageIcon, Quote, Code,
  AlignLeft, AlignCenter, AlignRight, Undo, Redo,
  X, Save, Upload, Plus, Trash2, Link as LinkIcon
} from 'lucide-react';
import { API_BASE } from '@/services/geminiService';
import { VideoUploader } from './VideoUploader';
import type { VideoCard } from '../../types/video';

// 标准肌肉群列表（与 queryExerciseLibrary.ts 保持一致）
const STANDARD_MUSCLE_GROUPS = [
  // 上肢-躯干
  "斜方肌", "上胸", "中下胸", "背部", "下背",
  // 上肢-手臂
  "三头", "内侧二头", "外侧二头", "后束", "中束", "前束", "小臂",
  // 核心
  "侧腹", "腹肌",
  // 下肢
  "小腿", "上臀部", "下臀部", "腘绳", "股四"
];

interface ActionEditorProps {
  initialData: any;
  onSave: (data: any) => void;
  onCancel: () => void;
  onUploadMedia?: (file: File) => Promise<string>;
}

interface MuscleGroup {
  name: string;
  type: 'primary' | 'secondary' | 'stabilizer';
}

const MenuBar = ({ editor, addImage, addLink }: {
  editor: any;
  addImage: () => void;
  addLink: () => void;
}) => {
  if (!editor) return null;

  const toolbarGroups = [
    // 撤销/重做
    {
      items: [
        {
          icon: Undo,
          title: '撤销',
          action: () => editor.chain().focus().undo().run(),
          active: false,
          disabled: !editor.can().undo()
        },
        {
          icon: Redo,
          title: '重做',
          action: () => editor.chain().focus().redo().run(),
          active: false,
          disabled: !editor.can().redo()
        }
      ]
    },
    // 文本格式
    {
      items: [
        {
          icon: Bold,
          title: '粗体',
          action: () => editor.chain().focus().toggleBold().run(),
          active: editor.isActive('bold')
        },
        {
          icon: Italic,
          title: '斜体',
          action: () => editor.chain().focus().toggleItalic().run(),
          active: editor.isActive('italic')
        }
      ]
    },
    // 标题
    {
      items: [
        {
          icon: Heading1,
          title: '一级标题',
          action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          active: editor.isActive('heading', { level: 1 })
        },
        {
          icon: Heading2,
          title: '二级标题',
          action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          active: editor.isActive('heading', { level: 2 })
        },
        {
          icon: Heading3,
          title: '三级标题',
          action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          active: editor.isActive('heading', { level: 3 })
        }
      ]
    },
    // 列表
    {
      items: [
        {
          icon: List,
          title: '无序列表',
          action: () => editor.chain().focus().toggleBulletList().run(),
          active: editor.isActive('bulletList')
        },
        {
          icon: ListOrdered,
          title: '有序列表',
          action: () => editor.chain().focus().toggleOrderedList().run(),
          active: editor.isActive('orderedList')
        }
      ]
    },
    // 引用和代码
    {
      items: [
        {
          icon: Quote,
          title: '引用',
          action: () => editor.chain().focus().toggleBlockquote().run(),
          active: editor.isActive('blockquote')
        },
        {
          icon: Code,
          title: '代码块',
          action: () => editor.chain().focus().toggleCodeBlock().run(),
          active: editor.isActive('codeBlock')
        }
      ]
    },
    // 对齐
    {
      items: [
        {
          icon: AlignLeft,
          title: '左对齐',
          action: () => editor.chain().focus().setTextAlign('left').run(),
          active: editor.isActive({ textAlign: 'left' })
        },
        {
          icon: AlignCenter,
          title: '居中',
          action: () => editor.chain().focus().setTextAlign('center').run(),
          active: editor.isActive({ textAlign: 'center' })
        },
        {
          icon: AlignRight,
          title: '右对齐',
          action: () => editor.chain().focus().setTextAlign('right').run(),
          active: editor.isActive({ textAlign: 'right' })
        }
      ]
    },
    // 媒体和链接
    {
      items: [
        {
          icon: LinkIcon,
          title: '插入链接',
          action: addLink
        },
        {
          icon: ImageIcon,
          title: '插入图片',
          action: addImage
        }
      ]
    }
  ];

  return (
    <div className="border-b border-admin-border p-2 bg-admin-card/50 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {toolbarGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-1">
            {group.items.map((item, itemIndex) => (
              <button
                key={itemIndex}
                onClick={item.action}
                disabled={item.disabled}
                className={`p-2 rounded hover:bg-admin-border transition-colors ${
                  item.active
                    ? 'text-star-accent bg-admin-border'
                    : 'text-admin-muted hover:text-white'
                } ${item.disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
                title={item.title}
              >
                <item.icon size={16} />
              </button>
            ))}
            {groupIndex < toolbarGroups.length - 1 && (
              <div className="w-[1px] h-5 bg-admin-border mx-1" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const ActionEditor = ({ initialData, onSave, onCancel, onUploadMedia }: ActionEditorProps) => {
  // DOMPurify 配置 - 不包含视频标签
  const purifyConfig = useMemo(() => ({
    ADD_TAGS: ['iframe'],
    ADD_ATTR: [
      'allow', 'allowfullscreen', 'src', 'loading', 'srcset', 'sizes'
    ],
    FORBID_TAGS: ['script', 'style', 'form', 'input', 'video', 'source', 'track'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  }), []);

  // Parse muscle_groups from JSON string or object to array structure
  const parseMuscleGroups = (data: string | object | null): MuscleGroup[] => {
    if (!data) return [];

    let parsed: any;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        return [];
      }
    } else {
      parsed = data;
    }

    if (!parsed || typeof parsed !== 'object') return [];

    // Convert {primary: [...], secondary: [...], stabilizers: [...]} to flat array
    const result: MuscleGroup[] = [];
    if (parsed.primary) {
      parsed.primary.forEach((name: string) => result.push({ name, type: 'primary' }));
    }
    if (parsed.secondary) {
      parsed.secondary.forEach((name: string) => result.push({ name, type: 'secondary' }));
    }
    if (parsed.stabilizers) {
      parsed.stabilizers.forEach((name: string) => result.push({ name, type: 'stabilizer' }));
    }
    return result;
  };

  // Parse equipment_required from JSON string or array
  const parseEquipment = (data: string | any[] | null): string[] => {
    if (!data) return [];

    if (Array.isArray(data)) {
      return data;
    }

    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  };

  const [formData, setFormData] = React.useState({
    id: initialData?.id || '',
    name: initialData?.name || '',
    body_category: initialData?.body_category || initialData?.category || 'push',
    exercise_type: initialData?.exercise_type || 'resistance',
    difficulty: initialData?.difficulty || 'beginner',
    cover: initialData?.assets?.cover || '',
  });

  const [muscleGroups, setMuscleGroups] = React.useState<MuscleGroup[]>(
    parseMuscleGroups(initialData?.muscle_groups || null)
  );
  const [equipment, setEquipment] = React.useState<string[]>(
    parseEquipment(initialData?.equipment_required || null)
  );

  // Video state
  const [videos, setVideos] = React.useState<VideoCard[]>(() => {
    const assets = initialData?.assets || (typeof initialData?.assets_json === 'string' ? JSON.parse(initialData.assets_json) : initialData?.assets_json);
    if (!assets?.video) return [];

    const list = Array.isArray(assets.video) ? assets.video : [assets.video];

    return list.map((v: any, index: number): VideoCard => {
      if (typeof v === 'string') {
        return {
          id: `video-${index}`,
          url: v,
          fileName: `视频 ${index + 1}`,
          createdAt: Date.now(),
        };
      }
      const baseUrl = v.baseUrl || '';
      const originalVideoUrl = v.originalVideoUrl || (baseUrl ? `${baseUrl}/original.mp4` : v.url || '');
      const poster = baseUrl
        ? `${baseUrl}/poster.jpg`
        : (v.posterUrl || v.poster || '');

      return {
        id: v.id || `video-${index}`,
        url: originalVideoUrl,
        poster,
        fileName: v.metadata?.originalFilename || v.fileName || `视频 ${index + 1}`,
        qualities: v.sources || v.qualities || [],
        createdAt: v.createdAt,
        baseUrl,
        originalVideoUrl,
      };
    });
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-lg max-w-full h-auto',
        },
      }),
      Youtube.configure({
        controls: false,
      }),
      Placeholder.configure({
        placeholder: '在此输入动作指导、步骤和注意事项...',
      }),
    ],
    content: initialData?.contentHtml || '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[300px]',
      },
    },
  });

  // Update formData when initialData changes (for editing existing exercises)
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        body_category: initialData.body_category || initialData.category || 'push',
        exercise_type: initialData.exercise_type || 'resistance',
        difficulty: initialData.difficulty || 'beginner',
        cover: initialData.assets?.cover || '',
      });
      setMuscleGroups(parseMuscleGroups(initialData.muscle_groups || null));
      setEquipment(parseEquipment(initialData.equipment_required || null));
    }
  }, [initialData]);

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const addImage = useCallback(() => {
    const url = window.prompt('输入图片URL:');
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  const addLink = useCallback(() => {
    const url = window.prompt('输入链接URL:');
    if (url && editor) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  // Convert muscle groups array back to nested object structure
  const formatMuscleGroups = () => {
    const result = { primary: [], secondary: [], stabilizers: [] };
    muscleGroups.forEach(mg => {
      // Filter out empty names
      if (mg.name && mg.name.trim()) {
        if (mg.type === 'primary') result.primary.push(mg.name.trim());
        else if (mg.type === 'secondary') result.secondary.push(mg.name.trim());
        else if (mg.type === 'stabilizer') result.stabilizers.push(mg.name.trim());
      }
    });
    return result;
  };

  // Filter equipment to remove empty strings
  const getValidEquipment = () => {
    return equipment.filter(eq => eq && eq.trim());
  };

  const handleSave = () => {
    if (!editor) return;
    const contentHtml = editor.getHTML();

    // Build muscle_groups object
    const muscleGroupsObj = formatMuscleGroups();
    const validEquipment = getValidEquipment();

    // Log what we're sending for debugging
    console.log('[ActionEditor] Saving muscle_groups:', muscleGroupsObj);
    console.log('[ActionEditor] Saving equipment_required:', validEquipment);
    console.log('[ActionEditor] Saving videos:', videos);

    const normalizePath = (url: string | undefined) => {
      if (!url) return '';
      if (url.startsWith('http')) {
        const apiBase = API_BASE.replace(/\/api\/?$/, '');
        if (url.startsWith(apiBase)) {
          return url.slice(apiBase.length) || '/';
        }
        const index = url.indexOf('/uploads/');
        return index !== -1 ? url.slice(index) : url;
      }
      return url;
    };

    onSave({
      id: initialData?.id,  // Don't generate UUID here, let parent handle it
      name: formData.name,
      body_category: formData.body_category,
      exercise_type: formData.exercise_type,
      difficulty: formData.difficulty,
      contentHtml,
      muscle_groups: JSON.stringify(muscleGroupsObj),
      equipment_required: JSON.stringify(validEquipment),
      assets: {
        ...initialData?.assets,
        cover: formData.cover,
        video: videos.length > 0
          ? videos.map(v => {
              const originalUrl = normalizePath(v.originalVideoUrl || v.url);
              const posterUrl = v.poster ? normalizePath(v.poster) : '';
              const baseUrl = originalUrl ? originalUrl.replace(/\/[^/]+$/, '') : '';

              return {
                type: 'local',
                originalVideoUrl: originalUrl,
                url: originalUrl,
                sources: v.qualities || [],
                posterUrl,
                baseUrl,
                metadata: v.metadata || {
                  originalFilename: v.fileName || '',
                  duration: 0,
                  width: 0,
                  height: 0,
                  codec: '',
                  bitrate: 0,
                  size: 0,
                },
              };
            })
          : null,
      }
    });
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadMedia) {
      try {
        const url = await onUploadMedia(file);
        setFormData(prev => ({ ...prev, cover: url }));
      } catch (e) {
        alert('Upload failed');
      }
    }
  };

  // Muscle group management
  const addMuscleGroup = () => {
    setMuscleGroups([...muscleGroups, { name: '', type: 'primary' }]);
  };

  const updateMuscleGroup = (index: number, field: keyof MuscleGroup, value: string) => {
    const updated = [...muscleGroups];
    updated[index] = { ...updated[index], [field]: value };
    setMuscleGroups(updated);
  };

  const removeMuscleGroup = (index: number) => {
    setMuscleGroups(muscleGroups.filter((_, i) => i !== index));
  };

  // Equipment management
  const addEquipment = () => {
    setEquipment([...equipment, '']);
  };

  const updateEquipment = (index: number, value: string) => {
    const updated = [...equipment];
    updated[index] = value;
    setEquipment(updated);
  };

  const removeEquipment = (index: number) => {
    setEquipment(equipment.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full bg-admin-bg text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-admin-border bg-admin-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">编辑动作</h2>
          <span className="text-xs text-admin-muted bg-admin-border/50 px-2 py-1 rounded">
            实时预览模式
          </span>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm text-admin-muted hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-4 py-2 rounded bg-star-accent text-black font-medium hover:bg-star-accent/90 transition-colors"
          >
            <Save size={16} />
            <span>保存更改</span>
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Metadata Form */}
        <div className="p-6 border-b border-admin-border">
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-3">
              <label className="block text-xs uppercase text-admin-muted font-semibold mb-2">动作封面</label>
              <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative group border border-admin-border">
                {formData.cover ? (
                  <img src={getFullUrl(formData.cover)} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full text-admin-muted">
                    <ImageIcon size={32} />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <label className="cursor-pointer bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-xs text-white backdrop-blur flex items-center gap-2">
                    <Upload size={12} />
                    <span>更换封面</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleCoverUpload} />
                  </label>
                </div>
              </div>
            </div>

            <div className="col-span-9 space-y-4">
              <div>
                <label className="block text-xs uppercase text-admin-muted font-semibold mb-2">动作名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-admin-card border border-admin-border rounded-lg px-4 py-2 text-white focus:border-star-accent outline-none"
                  placeholder="例如：杠铃卧推"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs uppercase text-admin-muted font-semibold mb-2">部位分类</label>
                  <select
                    value={formData.body_category}
                    onChange={e => setFormData(prev => ({ ...prev, body_category: e.target.value }))}
                    className="w-full bg-admin-card border border-admin-border rounded-lg px-4 py-2 text-white focus:border-star-accent outline-none"
                  >
                    <option value="push">胸部/推</option>
                    <option value="pull">背部/拉</option>
                    <option value="legs">腿部</option>
                    <option value="core">核心</option>
                    <option value="cardio">有氧</option>
                    <option value="shoulders">肩部</option>
                    <option value="arms">手臂</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase text-admin-muted font-semibold mb-2">动作类型</label>
                  <select
                    value={formData.exercise_type}
                    onChange={e => setFormData(prev => ({ ...prev, exercise_type: e.target.value }))}
                    className="w-full bg-admin-card border border-admin-border rounded-lg px-4 py-2 text-white focus:border-star-accent outline-none"
                  >
                    <option value="resistance">常规负重</option>
                    <option value="unilateral">单侧训练</option>
                    <option value="bodyweight">自重训练</option>
                    <option value="assisted">辅助器械</option>
                    <option value="isometric">静力/等长</option>
                    <option value="cardio">有氧运动</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase text-admin-muted font-semibold mb-2">难度等级</label>
                  <select
                    value={formData.difficulty}
                    onChange={e => setFormData(prev => ({ ...prev, difficulty: e.target.value }))}
                    className="w-full bg-admin-card border border-admin-border rounded-lg px-4 py-2 text-white focus:border-star-accent outline-none"
                  >
                    <option value="beginner">初级</option>
                    <option value="intermediate">中级</option>
                    <option value="advanced">高级</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Muscle Groups Section */}
        <div className="p-6 border-b border-admin-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-admin-muted uppercase">目标肌群</h3>
            <button
              onClick={addMuscleGroup}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-star-accent/10 text-star-accent text-sm hover:bg-star-accent/20 transition-colors"
            >
              <Plus size={14} />
              <span>添加肌群</span>
            </button>
          </div>
          <div className="space-y-2">
            {muscleGroups.map((mg, index) => (
              <div key={index} className="flex gap-2 items-center">
                <select
                  value={mg.name}
                  onChange={e => updateMuscleGroup(index, 'name', e.target.value)}
                  className="flex-1 bg-admin-card border border-admin-border rounded-lg px-3 py-2 text-sm text-white focus:border-star-accent outline-none"
                >
                  <option value="">选择肌群</option>
                  {STANDARD_MUSCLE_GROUPS.map(group => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
                <select
                  value={mg.type}
                  onChange={e => updateMuscleGroup(index, 'type', e.target.value)}
                  className="w-32 bg-admin-card border border-admin-border rounded-lg px-3 py-2 text-sm text-white focus:border-star-accent outline-none"
                >
                  <option value="primary">主练</option>
                  <option value="secondary">辅练</option>
                  <option value="stabilizer">稳定</option>
                </select>
                <button
                  onClick={() => removeMuscleGroup(index)}
                  className="p-2 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {muscleGroups.length === 0 && (
              <div className="text-center py-4 text-admin-muted text-sm">
                暂无肌群数据，点击上方按钮添加
              </div>
            )}
          </div>
        </div>

        {/* Equipment Section */}
        <div className="p-6 border-b border-admin-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-admin-muted uppercase">所需器械</h3>
            <button
              onClick={addEquipment}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-star-accent/10 text-star-accent text-sm hover:bg-star-accent/20 transition-colors"
            >
              <Plus size={14} />
              <span>添加器械</span>
            </button>
          </div>
          <div className="space-y-2">
            {equipment.map((eq, index) => (
              <div key={index} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={eq}
                  onChange={e => updateEquipment(index, e.target.value)}
                  placeholder="器械名称 (如：dumbbell)"
                  className="flex-1 bg-admin-card border border-admin-border rounded-lg px-3 py-2 text-sm text-white focus:border-star-accent outline-none"
                />
                <button
                  onClick={() => removeEquipment(index)}
                  className="p-2 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {equipment.length === 0 && (
              <div className="text-center py-4 text-admin-muted text-sm">
                暂无器械数据，点击上方按钮添加
              </div>
            )}
           </div>
         </div>

        {/* Video Management Section */}
        <div className="p-6 border-b border-admin-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-admin-muted uppercase">动作视频</h3>
          </div>
          <VideoUploader
            videos={videos}
            exerciseId={formData.id || 'temp-exercise'}
            onVideosChange={setVideos}
          />
        </div>

        {/* TipTap Editor - Split View */}
        <div className="p-6">
          <h3 className="text-sm font-semibold text-admin-muted uppercase mb-4">动作说明 - 实时预览</h3>

          {/* Split Container */}
          <div className="flex gap-6">
             {/* Left: Editor */}
             <div className="flex-1 border border-admin-border rounded-lg overflow-hidden bg-admin-card">
               <MenuBar editor={editor} addImage={addImage} addLink={addLink} />
               <div className="min-h-[500px] max-h-[600px] overflow-y-auto">
                 <EditorContent editor={editor} />
               </div>
             </div>

            {/* Right: Mobile Preview */}
            <div className="flex-shrink-0 w-[420px]">
              <div className="sticky top-6">
                <div className="text-xs text-admin-muted mb-3 text-center">手机端实时预览</div>

                {/* Phone Frame */}
                <div className="relative mx-auto" style={{ width: '375px' }}>
                  {/* Phone Outer Frame */}
                  <div className="w-full min-h-[667px] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border-8 border-gray-800 relative">

                    {/* Notch */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-800 rounded-b-2xl z-10"></div>

                    {/* Status Bar */}
                    <div className="bg-gray-100 px-6 py-2 flex justify-between items-center text-xs text-gray-600">
                      <span>9:41</span>
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                        </svg>
                      </div>
                    </div>

                    {/* Content Area */}
                    <div className="bg-white h-full overflow-y-auto" style={{ maxHeight: '580px' }}>
                      {/* Exercise Title */}
                      <div className="p-4 border-b border-gray-200">
                        <h1 className="text-xl font-bold text-gray-900">{formData.name}</h1>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs">
                            {formData.body_category}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs">
                            {formData.exercise_type}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            formData.difficulty === 'beginner' ? 'bg-green-100 text-green-700' :
                            formData.difficulty === 'intermediate' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {formData.difficulty === 'beginner' ? '初级' :
                             formData.difficulty === 'intermediate' ? '中级' : '高级'}
                          </span>
                        </div>
                      </div>

                      {/* Tutorial Content */}
                      <div className="p-4">
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(
                              editor?.getHTML() || '',
                              purifyConfig
                            )
                          }}
                        />
                      </div>
                    </div>

                    {/* Bottom Home Indicator */}
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-white border-t border-gray-200 flex justify-center items-center">
                      <div className="w-32 h-1 bg-gray-800 rounded-full"></div>
                    </div>
                  </div>

                  {/* Side Buttons */}
                  <div className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col gap-2">
                    <div className="w-1.5 h-12 bg-gray-700 rounded-full"></div>
                    <div className="w-1.5 h-12 bg-gray-700 rounded-full"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionEditor;
