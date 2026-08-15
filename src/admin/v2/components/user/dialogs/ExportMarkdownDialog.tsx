import React, { useState, useEffect } from 'react';
import { AdminService } from '../../../services/api';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { X, Calendar, Download, Eye, Loader2, FileText, ChevronRight, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MarkdownRenderer from '../../../../../components/MarkdownRenderer';
import { parseJSONSafe } from '../../../../../types/validation';

interface ExportMarkdownDialogProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportMarkdownDialog: React.FC<ExportMarkdownDialogProps> = ({ userId, isOpen, onClose }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState<number>(0);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setPreviewContent(null);
      setError(null);
      // Default to last 30 days
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      
      setEndDate(end.toISOString().split('T')[0]);
      setStartDate(start.toISOString().split('T')[0]);
    }
  }, [isOpen]);

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      // Format dates to ISO 8601 UTC as required by API
      const start = startDate ? new Date(startDate).toISOString() : undefined;
      const end = endDate ? new Date(`${endDate}T23:59:59Z`).toISOString() : undefined;

      const result = await AdminService.users.exportMarkdown(userId, start, end);
      setPreviewContent(result.markdown);
      setSessionCount(result.metadata.sessionCount as number);
    } catch (err: any) {
      console.error('[ExportMarkdown] Preview failed:', err);
      setError(err.message || '获取预览失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!previewContent) return;
    
    const blob = new Blob([previewContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training_report_${userId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = async () => {
    setExportingJson(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        AdminService.users.getProfile(userId),
        AdminService.users.getStats(userId)
      ]);
      
      const parseData = (data: any) => {
        return parseJSONSafe(data, 'ExportMarkdownDialog data') || {};
      };

      const exportData = {
        export_timestamp: new Date().toISOString(),
        user_id: userId,
        profile: {
          ...p,
          basic_info: parseData(p?.basic_info),
          preferences: parseData(p?.preferences),
          load_anchors: parseData(p?.load_anchors),
          physiological: parseData(p?.physiological),
          psychological: parseData(p?.psychological),
          training_strategy: p?.training_strategy || null,
          red_flags: Array.isArray(p?.red_flags) ? p.red_flags : (parseJSONSafe(p?.red_flags, 'red_flags') || [])
        },
        stats: s,
        sessions: Array.isArray(s) ? s : (s?.recent_sessions || [])
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_export_${userId.slice(0, 8)}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('[ExportMarkdown] JSON Export failed:', err);
      setError(err.message || '导出 JSON 失败');
    } finally {
      setExportingJson(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900 tracking-tight">导出训练报告 (Markdown)</h3>
              <p className="text-xs text-gray-500 font-medium">生成专业的可视化训练总结文档</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-400 transition-colors active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Panel: Settings */}
          <div className="w-full md:w-80 p-6 border-b md:border-b-0 md:border-r border-gray-100 bg-white space-y-6 overflow-y-auto">
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 block">开始日期</span>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                    <Calendar size={14} />
                  </div>
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-mono"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 block">结束日期</span>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                    <Calendar size={14} />
                  </div>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-mono"
                  />
                </div>
              </label>
            </div>

            <div className="pt-4">
              <Button 
                onClick={handlePreview} 
                loading={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-200"
                icon={<Eye size={16} />}
              >
                生成预览
              </Button>
            </div>

            {previewContent && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-green-50 border border-green-100 rounded-2xl"
              >
                <div className="flex items-center gap-2 text-green-700 font-bold text-sm mb-1">
                  <Loader2 size={14} className="animate-spin" />
                  解析成功
                </div>
                <p className="text-xs text-green-600/80">
                  共计包含 <span className="font-black underline">{sessionCount}</span> 次训练记录
                </p>
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3"
              >
                <AlertCircle size={16} className="text-red-500 shrink-0" />
                <div className="text-xs text-red-600 leading-relaxed font-medium">
                  {error}
                </div>
              </motion.div>
            )}
          </div>

          {/* Right Panel: Preview */}
          <div className="flex-1 bg-gray-50/50 overflow-hidden flex flex-col relative">
            {!previewContent && !loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6 text-gray-200 border border-gray-100">
                  <FileText size={40} />
                </div>
                <h4 className="text-lg font-bold text-gray-900 mb-2">准备生成报告</h4>
                <p className="text-sm max-w-xs leading-relaxed">
                  选择左侧的时间范围，点击“生成预览”按钮即可查看导出的 Markdown 文档效果。
                </p>
              </div>
            )}

            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm z-10">
                <Loader2 size={32} className="text-blue-500 animate-spin mb-4" />
                <span className="text-sm font-bold text-gray-600">正在从 L3 DB 聚合数据...</span>
              </div>
            )}

            {previewContent && (
              <div className="flex-1 overflow-y-auto p-8 bg-white">
                <div className="max-w-2xl mx-auto prose prose-sm prose-slate">
                  <MarkdownRenderer content={previewContent} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-white flex justify-between items-center">
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2">
            Protocol Version: <span className="text-blue-500">2.0.0</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full" />
            UTF-8 Encoded
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={handleDownloadJSON} 
              loading={exportingJson}
              className="text-gray-700 border-gray-200 hover:bg-gray-50"
              icon={<Download size={16} />}
            >
              导出 JSON
            </Button>
            <Button 
              onClick={handleDownload} 
              disabled={!previewContent}
              className="bg-gray-900 hover:bg-black text-white font-bold px-8 rounded-2xl shadow-xl shadow-gray-200"
              icon={<Download size={16} />}
            >
              下载报告 (.md)
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
