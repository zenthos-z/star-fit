import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Upload, Download, FileUp, AlertTriangle, 
  CheckCircle, Loader2, FileArchive, ChevronRight 
} from 'lucide-react';
import { 
  ExerciseLibraryIOService, 
  PrecheckResponse, 
  ConflictStrategy, 
  ImportStatus, 
  ImportResult 
} from '../../src/services/exerciseLibraryIOService';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose }) => {
  const [includeVideos, setIncludeVideos] = useState(true);
  const [videoQuality, setVideoQuality] = useState<'360p' | '720p' | '1080p'>('1080p');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      await ExerciseLibraryIOService.exportExercises({
        includeVideos,
        videoQuality
      });
      onClose();
    } catch (err: any) {
      setError(err.message || '导出失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col m-4 animate-in zoom-in-95 duration-200 text-gray-900">
        
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-black text-gray-900">导出动作库</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                <FileUp size={20} />
              </div>
              <div>
                <p className="font-bold text-gray-900">包含演示视频</p>
                <p className="text-xs text-gray-500">文件体积可能会较大</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={includeVideos}
                onChange={e => setIncludeVideos(e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-star-dark"></div>
            </label>
          </div>

          {includeVideos && (
            <div className="space-y-3">
              <label className="text-sm font-bold text-gray-500 uppercase">视频清晰度</label>
              <div className="grid grid-cols-3 gap-2">
                {(['360p', '720p', '1080p'] as const).map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setVideoQuality(q)}
                    className={`py-2 px-3 rounded-lg text-sm font-bold border transition-all ${
                      videoQuality === q 
                        ? 'bg-star-dark text-white border-star-dark' 
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>

        <div className="p-6 pt-0">
          <button
            onClick={handleExport}
            disabled={loading}
            className="w-full py-4 bg-star-dark text-white rounded-xl font-bold shadow-lg hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
            {loading ? '正在导出...' : '确认导出'}
          </button>
        </div>

      </div>
    </div>
  );
};

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = 'upload' | 'precheck' | 'importing' | 'result';

export const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onSuccess }) => {
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [precheckData, setPrecheckData] = useState<PrecheckResponse | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('rename');

  const [progress, setProgress] = useState<ImportStatus | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (open) {
      setStep('upload');
      setFile(null);
      setError(null);
      setPrecheckData(null);
      setProgress(null);
      setImportResult(null);
      setStrategy('rename');
    }
    return () => stopPolling();
  }, [open]);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  if (!open) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith('.zip')) {
      setError('请上传 .zip 格式的文件');
      return;
    }

    setFile(selected);
    setLoading(true);
    setError(null);

    try {
      const result = await ExerciseLibraryIOService.precheckImport(selected);
      setPrecheckData(result);
      setStep('precheck');
    } catch (err: any) {
      console.error('[ImportDialog] Precheck error:', err);
      setError(err.message || '预检失败');
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStartImport = async () => {
    if (!file) return;
    console.log('[ImportDialog] Starting import...');
    setLoading(true);
    setStep('importing');

    try {
      const result = await ExerciseLibraryIOService.importExercises(file, strategy);
      console.log('[ImportDialog] Import started, batchId:', result.batchId);
      pollProgress(result.batchId);
    } catch (err: any) {
      console.error('[ImportDialog] Import start error:', err);
      setError(err.message || '导入启动失败');
      setStep('result');
    }
  };

  const pollProgress = (batchId: string) => {
    console.log('[ImportDialog] Starting poll for batchId:', batchId);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await ExerciseLibraryIOService.getImportStatus(batchId);
        console.log('[ImportDialog] Poll status:', status.status, 'processed:', status.processedExercises, 'total:', status.totalExercises);
        setProgress(status);

        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          console.log('[ImportDialog] Import finished:', status.status);
          stopPolling();
          if (status.status === 'completed') {
            setImportResult({
                success: status.processedExercises,
                skipped: 0,
                failed: status.errors.length,
                errors: status.errors,
                videoTasks: [],
                renamedExercises: [],
                batchId
            });
            setStep('result');
            console.log('[ImportDialog] Calling onSuccess...');
            onSuccess();
          } else {
            setError(status.errors?.[0]?.error || '导入失败');
            setStep('result');
          }
        }
      } catch (err) {
        console.error('[ImportDialog] Poll failed:', err);
      }
    }, 1000);
  };

  const handleClose = () => {
    stopPolling();
    onClose();
  };

  const renderUpload = () => (
    <div 
      className="border-2 border-dashed border-gray-300 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-star-dark hover:bg-gray-50 transition-all group"
      onClick={() => fileInputRef.current?.click()}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".zip" 
        onChange={handleFileSelect} 
      />
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-white group-hover:shadow-md transition-all">
        {loading ? <Loader2 className="animate-spin text-gray-400" size={32} /> : <FileArchive className="text-gray-400 group-hover:text-star-dark" size={32} />}
      </div>
      <p className="text-lg font-bold text-gray-700 mb-2">
        {loading ? '正在解析...' : '点击或拖拽上传 ZIP 文件'}
      </p>
      <p className="text-sm text-gray-400">
        支持从其他设备导出的标准动作库包
      </p>
    </div>
  );

  const renderPrecheck = () => {
    if (!precheckData) return null;
    const { manifest, conflicts } = precheckData;
    const hasConflicts = conflicts.length > 0;

    return (
      <div className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-4 flex justify-between items-center">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase">动作数量</p>
            <p className="text-xl font-black text-gray-900">{manifest.totalExercises}</p>
          </div>
          <div className="w-px h-8 bg-gray-200"></div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase">视频资源</p>
            <p className="text-xl font-black text-gray-900">{manifest.totalVideos}</p>
          </div>
          <div className="w-px h-8 bg-gray-200"></div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase">导出时间</p>
            <p className="text-xl font-black text-gray-900">{new Date(manifest.exportedAt).toLocaleDateString()}</p>
          </div>
        </div>

        {hasConflicts ? (
          <div className="border border-orange-100 bg-orange-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3 text-orange-700">
              <AlertTriangle size={20} />
              <span className="font-bold">发现 {conflicts.length} 个同名动作冲突</span>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold text-orange-600 uppercase">请选择处理方式:</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setStrategy('rename')}
                  className={`flex items-center p-3 rounded-lg border text-left transition-all ${
                    strategy === 'rename' 
                      ? 'bg-white border-orange-500 shadow-sm ring-1 ring-orange-500' 
                      : 'bg-white/50 border-orange-200 hover:bg-white'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border mr-3 flex items-center justify-center ${strategy === 'rename' ? 'border-orange-500' : 'border-gray-400'}`}>
                    {strategy === 'rename' && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                  </div>
                  <div>
                    <span className="font-bold text-gray-900 block">自动重命名 (推荐)</span>
                    <span className="text-xs text-gray-500">保留两者，新动作添加后缀 (如 "深蹲 (2)")</span>
                  </div>
                </button>
                
                <button
                  onClick={() => setStrategy('overwrite')}
                  className={`flex items-center p-3 rounded-lg border text-left transition-all ${
                    strategy === 'overwrite' 
                      ? 'bg-white border-orange-500 shadow-sm ring-1 ring-orange-500' 
                      : 'bg-white/50 border-orange-200 hover:bg-white'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border mr-3 flex items-center justify-center ${strategy === 'overwrite' ? 'border-orange-500' : 'border-gray-400'}`}>
                    {strategy === 'overwrite' && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                  </div>
                  <div>
                    <span className="font-bold text-gray-900 block">覆盖旧数据</span>
                    <span className="text-xs text-gray-500">使用新动作替换现有动作</span>
                  </div>
                </button>

                <button
                  onClick={() => setStrategy('skip')}
                  className={`flex items-center p-3 rounded-lg border text-left transition-all ${
                    strategy === 'skip' 
                      ? 'bg-white border-orange-500 shadow-sm ring-1 ring-orange-500' 
                      : 'bg-white/50 border-orange-200 hover:bg-white'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border mr-3 flex items-center justify-center ${strategy === 'skip' ? 'border-orange-500' : 'border-gray-400'}`}>
                    {strategy === 'skip' && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                  </div>
                  <div>
                    <span className="font-bold text-gray-900 block">跳过</span>
                    <span className="text-xs text-gray-500">保留现有动作，不导入新动作</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-xl border border-green-100">
            <CheckCircle size={20} />
            <span className="font-bold">未发现冲突，可以安全导入</span>
          </div>
        )}

        <button
          onClick={handleStartImport}
          className="w-full py-4 bg-star-dark text-white rounded-xl font-bold shadow-lg hover:bg-black active:scale-[0.98] transition-all"
        >
          开始导入
        </button>
      </div>
    );
  };

  const renderProgress = () => {
    if (!progress) return (
      <div className="flex flex-col items-center justify-center py-10">
        <Loader2 className="animate-spin mb-4 text-star-dark" size={40} />
        <p className="font-bold text-gray-500">正在初始化...</p>
      </div>
    );

    const exercisePercent = progress.totalExercises > 0 
      ? Math.round((progress.processedExercises / progress.totalExercises) * 100) 
      : 0;
    
    const videoTotal = progress.videoTasks.total;
    const videoProcessed = progress.videoTasks.completed + progress.videoTasks.failed;
    const videoPercent = videoTotal > 0 
      ? Math.round((videoProcessed / videoTotal) * 100) 
      : 0;

    return (
      <div className="space-y-8 py-4">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="font-bold text-gray-900">动作数据导入</span>
            <span className="font-mono font-bold text-star-dark">{exercisePercent}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-star-dark transition-all duration-300 ease-out"
              style={{ width: `${exercisePercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 text-right">
            {progress.processedExercises} / {progress.totalExercises}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="font-bold text-gray-900">视频资源处理</span>
            <span className="font-mono font-bold text-blue-600">{videoPercent}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${videoPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>处理中: {progress.videoTasks.processing}</span>
            <span>{videoProcessed} / {videoTotal}</span>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-sm font-bold text-gray-500 animate-pulse">
            正在后台处理数据，请勿关闭窗口...
          </p>
        </div>
      </div>
    );
  };

  const renderResult = () => {
    if (error) {
      return (
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="text-red-500" size={32} />
          </div>
          <h3 className="text-xl font-black text-gray-900 mb-2">导入失败</h3>
          <p className="text-gray-500 mb-6">{error}</p>
          <button
            onClick={() => setStep('upload')}
            className="w-full py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all"
          >
            重试
          </button>
        </div>
      );
    }

    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-500" size={32} />
        </div>
        <h3 className="text-xl font-black text-gray-900 mb-2">导入完成</h3>
        <p className="text-gray-500 mb-6">
          成功导入 {importResult?.success} 个动作
          {importResult?.failed ? `，失败 ${importResult.failed} 个` : ''}
        </p>
        <button
          onClick={handleClose}
          className="w-full py-3 bg-star-dark text-white rounded-xl font-bold shadow-lg hover:bg-black transition-all"
        >
          完成
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col m-4 animate-in zoom-in-95 duration-200 max-h-[90vh]">
        
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <h2 className="text-xl font-black text-gray-900">导入动作库</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-black transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {step === 'upload' && renderUpload()}
          {step === 'precheck' && renderPrecheck()}
          {step === 'importing' && renderProgress()}
          {step === 'result' && renderResult()}
        </div>

        {error && step === 'upload' && (
          <div className="px-6 pb-6">
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
