import React, { useState, useEffect } from 'react';
import { Plus, Search, Filter, ArrowUpDown, RefreshCw, Trash2, Check, CheckSquare, Square, Upload, Download } from 'lucide-react';
import { ActionCard } from './ActionCard';
import { Button } from '../../ui/Button';
import { AdminService } from '../../../services/api';
import { Exercise } from '../../../services/types';
import { ActionEditor } from '../ActionEditor';
import { ExportDialog, ImportDialog } from '@/components/ExerciseIO/ExerciseIODialogs';

type SortOption = 'name-asc' | 'name-desc' | 'created-asc' | 'created-desc' | 'modified-asc' | 'modified-desc';

export const ActionList: React.FC = () => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>('name-asc');
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (showRefreshAnimation = false) => {
    if (showRefreshAnimation) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const data = await AdminService.exercises.list();

      const deduplicated = data.reduce<Exercise[]>((acc, exercise) => {
        const id = String((exercise as any).id);
        const existing = acc.find(ex => String((ex as any).id) === id);

        if (!existing) {
          acc.push(exercise);
        }

        return acc;
      }, []);

      setExercises(deduplicated);
    } finally {
      if (!showRefreshAnimation) {
        setLoading(false);
      }
      if (showRefreshAnimation) {
        setTimeout(() => setIsRefreshing(false), 300);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这个动作吗？')) {
      await AdminService.exercises.delete(id);
      setExercises(prev => prev.filter(ex => String((ex as any).id) !== id));
    }
  };

  const handleSelectAll = () => {
    const validIds = validFiltered.map(ex => String((ex as any).id).trim());
    if (selectedIds.size === validIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(validIds));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      alert('请先选择要删除的动作');
      return;
    }

    if (confirm(`确定要删除选中的 ${selectedIds.size} 个动作吗？`)) {
      try {
        await Promise.all(
          Array.from(selectedIds).map(id => AdminService.exercises.delete(id))
        );
        setExercises(prev => prev.filter(ex => !selectedIds.has(String((ex as any).id))));
        setSelectedIds(new Set());
      } catch (error) {
        alert('删除失败，请重试');
      }
    }
  };

  const handleSort = (option: SortOption) => {
    setSortBy(option);
  };

  const sortExercises = (exercises: Exercise[]): Exercise[] => {
    const sorted = [...exercises];
    switch (sortBy) {
      case 'name-asc':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return sorted.sort((a, b) => b.name.localeCompare(a.name));
      case 'created-asc':
        return sorted.sort((a, b) => {
          const timeA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const timeB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return timeA - timeB;
        });
      case 'created-desc':
        return sorted.sort((a, b) => {
          const timeA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const timeB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return timeB - timeA;
        });
      case 'modified-asc':
        return sorted.sort((a, b) => {
          const timeA = (a as any).modified_at ? new Date((a as any).modified_at).getTime() : 0;
          const timeB = (b as any).modified_at ? new Date((b as any).modified_at).getTime() : 0;
          return timeA - timeB;
        });
      case 'modified-desc':
        return sorted.sort((a, b) => {
          const timeA = (a as any).modified_at ? new Date((a as any).modified_at).getTime() : 0;
          const timeB = (b as any).modified_at ? new Date((b as any).modified_at).getTime() : 0;
          return timeB - timeA;
        });
      default:
        return sorted;
    }
  };

  const filtered = exercises.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || e.exercise_type === filter;
    return matchSearch && matchFilter;
  });

  const validFiltered = filtered.filter((e) => {
    const id = String((e as any).id ?? '').trim();
    return id !== '' && id !== 'null' && id !== 'undefined';
  });

  const sortedFiltered = sortExercises(validFiltered);

  const allSelected = validFiltered.length > 0 && selectedIds.size === validFiltered.length;

  const handleRefresh = () => {
    loadData(true);
  };

  const handleSelect = (id: string, isRange: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      const toggleSingle = () => {
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      };

      if (isRange && lastSelectedId) {
        const orderedIds = sortedFiltered.map(ex => String((ex as any).id).trim());
        const startIndex = orderedIds.indexOf(lastSelectedId);
        const endIndex = orderedIds.indexOf(id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          for (let i = from; i <= to; i += 1) {
            const rangeId = orderedIds[i];
            if (rangeId) {
              newSet.add(rangeId);
            }
          }
        } else {
          toggleSingle();
        }
      } else {
        toggleSingle();
      }
      return newSet;
    });
    setLastSelectedId(id);
  };

  if (editingId !== null) {
    return (
      <ActionEditor
        exerciseId={editingId === 'new' ? undefined : editingId}
        onBack={() => {
          setEditingId(null);
          loadData(false);
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col space-y-6" data-testid="admin-content">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-100 px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              data-testid="admin-content-select-all"
            >
              {allSelected ? (
                <CheckSquare size={16} className="text-star-accent" />
              ) : (
                <Square size={16} className="text-gray-400" />
              )}
              <span className="text-gray-700">
                {allSelected ? '取消全选' : '全选'}
              </span>
            </button>

            {selectedIds.size > 0 && (
                <Button
                  onClick={handleBulkDelete}
                  icon={<Trash2 size={16} />}
                  variant="danger"
                  data-testid="admin-content-bulk-delete"
                >
                  删除选中 ({selectedIds.size})
                </Button>
              )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="搜索动作..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="admin-content-search"
                className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-star-accent/20 outline-none w-64"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gray-400" />
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                data-testid="admin-content-filter"
                className="bg-transparent text-sm font-medium text-gray-600 outline-none cursor-pointer"
              >
                <option value="all">全部类型</option>
                <option value="resistance">常规负重</option>
                <option value="unilateral">单侧训练</option>
                <option value="bodyweight">自重训练</option>
                <option value="assisted">辅助器械</option>
                <option value="isometric">静力/等长</option>
                <option value="cardio">有氧运动</option>
                <option value="flexibility">柔韧性训练</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <ArrowUpDown size={16} className="text-gray-400" />
              <select
                value={sortBy}
                onChange={e => handleSort(e.target.value as SortOption)}
                data-testid="admin-content-sort"
                className="bg-transparent text-sm font-medium text-gray-600 outline-none cursor-pointer"
              >
                <option value="name-asc">名称 A-Z</option>
                <option value="name-desc">名称 Z-A</option>
                <option value="created-asc">创建时间 ↑</option>
                <option value="created-desc">创建时间 ↓</option>
                <option value="modified-asc">修改时间 ↑</option>
                <option value="modified-desc">修改时间 ↓</option>
              </select>
            </div>
          </div>

          <Button onClick={() => setEditingId('new')} icon={<Plus size={16} />} data-testid="admin-content-new">
            新建动作
          </Button>

          {/* IO Buttons */}
          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-lg transition-all ${isRefreshing ? 'text-star-dark' : 'text-gray-400 hover:text-black hover:bg-gray-50'}`}
              title="刷新"
            >
              <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setIsExportOpen(true)}
              className="p-2 text-gray-400 hover:text-black hover:bg-gray-50 rounded-lg transition-all"
              title="导出动作库"
            >
              <Upload size={20} />
            </button>
            <button
              onClick={() => setIsImportOpen(true)}
              className="p-2 text-gray-400 hover:text-black hover:bg-gray-50 rounded-lg transition-all"
              title="导入动作库"
            >
              <Download size={20} />
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 mb-4 bg-star-accent/10 border border-star-accent/20 rounded-lg text-sm text-star-accent">
            <Check size={16} />
            <span>已选择 {selectedIds.size} 个动作</span>
          </div>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-20 text-gray-400" data-testid="admin-content-loading">
          加载中...
        </div>
      ) : (
        <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 pb-8 px-8 transition-all duration-300 ${isRefreshing ? 'opacity-50 scale-95' : ''}`} data-testid="admin-content-grid">
          {sortedFiltered.map(ex => (
            <ActionCard
              key={`${ex.id}-${ex.name}`}
              exercise={ex}
              selected={selectedIds.has(String((ex as any).id).trim())}
              onSelect={(shiftKey) => handleSelect(String((ex as any).id).trim(), shiftKey)}
              onEdit={() => setEditingId(String((ex as any).id).trim())}
              onDelete={() => handleDelete(String((ex as any).id).trim())}
            />
          ))}
        </div>
      )}

      <ExportDialog open={isExportOpen} onClose={() => setIsExportOpen(false)} />
      <ImportDialog
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => {
          setIsImportOpen(false);
          setTimeout(() => loadData(true), 100);
        }}
      />
    </div>
  );
};
