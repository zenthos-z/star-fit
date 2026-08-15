import React, { useState, useEffect } from 'react';
import { Activity, Plus, Search, Loader, Video, Trash2 } from 'lucide-react';
import ActionEditor from './ActionEditor';
import { API_BASE, getHeaders, getUserId } from '@/services/geminiService';

// Interfaces mapping to DB
interface Exercise {
  id: string;
  name: string;
  body_category: 'push' | 'pull' | 'legs' | 'core' | 'cardio' | 'shoulders' | 'arms';
  exercise_type: string;
  content_html: string;
  assets_json: string;
  tags_json?: string;
  muscle_groups: string; // JSON
  equipment_required: string; // JSON
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

// --- Sub-Components ---

const ActionGrid = ({
  actions,
  onEdit,
  onNew,
  onDelete
}: {
  actions: Exercise[],
  onEdit: (action: Exercise) => void,
  onNew: () => void,
  onDelete: (id: string) => void
}) => {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterDiff, setFilterDiff] = useState('all');

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  // 解析 JSON 字段的辅助函数
  const parseMuscleGroups = (json: string | null) => {
    if (!json) return { primary: [], secondary: [], stabilizers: [] };
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') return { primary: [], secondary: [], stabilizers: [] };
      return parsed;
    } catch { return { primary: [], secondary: [], stabilizers: [] }; }
  };

  const parseEquipment = (json: string | null) => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch { return []; }
  };

  const filtered = actions.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === 'all' || a.body_category === filterCat;
    const matchDiff = filterDiff === 'all' || a.difficulty === filterDiff;
    return matchSearch && matchCat && matchDiff;
  });

  // 分类显示名称映射
  const categoryNames: Record<string, string> = {
    'push': '胸部/推',
    'pull': '背部/拉',
    'legs': '腿部',
    'core': '核心',
    'cardio': '有氧',
    'shoulders': '肩部',
    'arms': '手臂'
  };

  // 难度显示名称映射
  const difficultyNames: Record<string, string> = {
    'beginner': '初级',
    'intermediate': '中级',
    'advanced': '高级'
  };

  // 难度颜色映射
  const difficultyColors: Record<string, string> = {
    'beginner': 'bg-green-500/20 text-green-400',
    'intermediate': 'bg-yellow-500/20 text-yellow-400',
    'advanced': 'bg-red-500/20 text-red-400'
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6 flex-shrink-0">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-admin-muted" size={16} />
          <input
            type="text"
            placeholder="搜索动作..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-admin-card border border-admin-border rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:border-star-accent outline-none"
          />
        </div>
        <div className="flex space-x-3">
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            className="bg-admin-card border border-admin-border rounded-lg px-3 py-2 text-sm text-white outline-none"
          >
            <option value="all">全部部位</option>
            <option value="push">胸部/推</option>
            <option value="pull">背部/拉</option>
            <option value="legs">腿部</option>
            <option value="core">核心</option>
            <option value="cardio">有氧</option>
            <option value="shoulders">肩部</option>
            <option value="arms">手臂</option>
          </select>
          <select
            value={filterDiff}
            onChange={e => setFilterDiff(e.target.value)}
            className="bg-admin-card border border-admin-border rounded-lg px-3 py-2 text-sm text-white outline-none"
          >
            <option value="all">全部难度</option>
            <option value="beginner">初级</option>
            <option value="intermediate">中级</option>
            <option value="advanced">高级</option>
          </select>
          <button
            onClick={onNew}
            className="flex items-center space-x-2 bg-star-accent hover:bg-star-accent/90 text-black px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            <span>新建动作</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
          {filtered.map((action) => {
            let assets = {};
            try { assets = JSON.parse(action.assets_json || '{}'); } catch {}
            const cover = (assets as any).cover;
            const muscleData = parseMuscleGroups(action.muscle_groups);
            const equipmentList = parseEquipment(action.equipment_required);

            return (
              <div
                key={action.id}
                className="bg-admin-card border border-admin-border rounded-lg overflow-hidden cursor-pointer hover:border-star-accent transition-all hover:shadow-lg group flex flex-col h-full relative"
              >
                <div className="aspect-video bg-gray-800 relative" onClick={() => onEdit(action)}>
                  {cover ? (
                    <img src={getFullUrl(cover)} alt={action.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-admin-muted">
                      <Activity size={32} />
                    </div>
                  )}
                  {(assets as any).video && (
                    <div className="absolute top-2 right-2 px-2 py-1 rounded bg-black/60 text-white text-xs backdrop-blur flex items-center gap-1">
                       <Video size={10} /> Video
                    </div>
                  )}
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`确定要删除动作 "${action.name}" 吗？`)) {
                      onDelete(action.id);
                    }
                  }}
                  className="absolute top-2 left-2 p-1.5 bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white rounded-md opacity-0 group-hover:opacity-100 transition-all z-10 backdrop-blur-sm"
                  title="删除动作"
                >
                  <Trash2 size={14} />
                </button>

                <div className="p-4 flex-1" onClick={() => onEdit(action)}>
                  <h3 className="text-white font-medium mb-2 group-hover:text-star-accent line-clamp-1" title={action.name}>{action.name}</h3>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-admin-muted uppercase">
                      {categoryNames[action.body_category] || action.body_category}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${difficultyColors[action.difficulty]}`}>
                      {difficultyNames[action.difficulty]}
                    </span>
                  </div>
                  {/* 显示器械 */}
                  {equipmentList.length > 0 && (
                    <div className="text-xs text-admin-muted truncate" title={equipmentList.join(', ')}>
                      器械: {equipmentList.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const KnowledgeBase = () => {
  const [actions, setActions] = useState<Exercise[]>([]);
  const [editingAction, setEditingAction] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // 使用新的 API 端点
      const res = await fetch(`${API_BASE}/exercises`, {
        headers: getHeaders()
      });
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      // 确保数据是数组
      setActions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load exercises:', e);
      setActions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveAction = async (data: any) => {
    // Check if this is an existing exercise by:
    // 1. Has a valid ID that exists in current actions list
    // 2. Or has a name that matches an existing exercise (for cases where ID might be missing)
    const hasValidId = data.id && actions.some((a: Exercise) => a.id === data.id);
    const existingByName = actions.find((a: Exercise) => a.name === data.name && a.id !== data.id);
    const isExisting = hasValidId || existingByName;

    // For existing exercises found by name, use their ID
    const exerciseId = isExisting
      ? (data.id || existingByName?.id)
      : crypto.randomUUID();

    // Convert frontend model to DB model
    const payload = {
      id: exerciseId,
      name: data.name,
      body_category: data.body_category || data.category,
      exercise_type: data.exercise_type,
      muscle_groups: data.muscle_groups,
      equipment_required: data.equipment_required,
      difficulty: data.difficulty || 'beginner',
      content_html: data.contentHtml,
      assets_json: JSON.stringify(data.assets || {}),
      tags_json: JSON.stringify(data.tags || [])
    };

    console.log('[KnowledgeBase] Saving exercise:', payload);
    console.log('[KnowledgeBase] Is existing exercise:', isExisting, 'ID:', exerciseId);

    try {
      // Use PUT for existing exercises, POST for new ones
      const url = isExisting ? `${API_BASE}/exercises/${exerciseId}` : `${API_BASE}/exercises`;
      const method = isExisting ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      console.log('[KnowledgeBase] Save response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[KnowledgeBase] Save failed:', errorData);
        alert('保存失败: ' + (errorData.error || errorData.details || '未知错误'));
        return;
      }

      const result = await res.json();
      console.log('[KnowledgeBase] Save successful:', result);

      setEditingAction(null);
      loadData();
    } catch (e) {
      console.error('[KnowledgeBase] Save error:', e);
      alert('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleDeleteAction = async (id: string) => {
    console.log('[KnowledgeBase] Deleting exercise:', id);

    try {
      const res = await fetch(`${API_BASE}/exercises/${id}`, {
        method: 'DELETE',
        headers: getHeaders({}, false)  // DELETE 请求不需要 Content-Type
      });

      console.log('[KnowledgeBase] Delete response status:', res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[KnowledgeBase] Delete failed:', errorData);
        alert('删除失败: ' + (errorData.error || errorData.details || '未知错误'));
        return;
      }

      const result = await res.json();
      console.log('[KnowledgeBase] Delete successful:', result);

      loadData();
    } catch (e) {
      console.error('[KnowledgeBase] Delete error:', e);
      alert('Delete failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Upload handler passed to ActionEditor
  const handleUpload = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/media/upload`, {
        method: 'POST',
        headers: {
          'X-User-Id': getUserId()
        },
        body: formData
    });
    const data = await res.json();
    return data.url; // Relative path e.g. /uploads/xxx.mp4
  };

  return (
    <div className="flex h-full bg-admin-bg relative">
      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Loader className="animate-spin text-star-accent" />
          </div>
        )}

        <ActionGrid
          actions={actions}
          onEdit={(a) => {
              // Map DB model back to Editor model
              const assets = JSON.parse(a.assets_json || '{}');
              setEditingAction({
                  ...a,
                  contentHtml: a.content_html,
                  assets: assets,
                  muscle_groups: a.muscle_groups,
                  equipment_required: a.equipment_required
              } as any);
          }}
          onNew={() => setEditingAction({
            name: '新动作',
            body_category: 'push',
            exercise_type: 'resistance',
            difficulty: 'beginner'
          } as any)}
          onDelete={handleDeleteAction}
        />
      </div>

      {/* Editor Modal */}
      {editingAction && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-10">
          <div className="bg-admin-bg border border-admin-border rounded-xl w-full max-w-6xl h-full shadow-2xl flex flex-col overflow-hidden">
            <ActionEditor
              initialData={editingAction}
              onSave={handleSaveAction}
              onCancel={() => setEditingAction(null)}
              // Inject upload handler
              onUploadMedia={handleUpload}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
