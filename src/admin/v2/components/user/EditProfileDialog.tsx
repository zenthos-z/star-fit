import React, { useState, useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PhysioSection } from './edit-sections/PhysioSection';
import { PhysiologicalSection } from './edit-sections/PhysiologicalSection';
import { PsychologicalSection } from './edit-sections/PsychologicalSection';
import { PreferencesSection } from './edit-sections/PreferencesSection';
import { LoadAnchorsSection } from './edit-sections/LoadAnchorsSection';
import { parseJSONSafe } from '../../../../types/validation';

interface EditProfileDialogProps {
  userId: string;
  initialData: any;
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  onOpenLoadAnchorsPage?: () => void;
}

export const EditProfileDialog: React.FC<EditProfileDialogProps> = ({
  userId,
  initialData,
  open,
  onClose,
  onSave,
  onOpenLoadAnchorsPage
}) => {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // States for all data sections
  const [basicInfo, setBasicInfo] = useState<any>({});
  const [preferences, setPreferences] = useState<any>({});
  const [loadAnchors, setLoadAnchors] = useState<any>({});
  const [physiological, setPhysiological] = useState<any>({});
  const [psychological, setPsychological] = useState<any>({});
  const [fitnessLevel, setFitnessLevel] = useState<string>('beginner');
  const [redFlags, setRedFlags] = useState<string[]>([]);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (open && !initializedRef.current) {
      const parseData = (data: any) => {
        return parseJSONSafe(data, 'EditProfileDialog data') || {};
      };

      setBasicInfo(parseData(initialData.basic_info));
      setPreferences(parseData(initialData.preferences));
      setLoadAnchors(parseData(initialData.load_anchors));
      setPhysiological(parseData(initialData.physiological));
      setPsychological(parseData(initialData.psychological));
      setFitnessLevel(initialData.fitness_level || 'beginner');
      setRedFlags(Array.isArray(initialData.red_flags) ? initialData.red_flags : []);

      setSaveError(null);
      initializedRef.current = true;
    } else if (!open) {
      initializedRef.current = false;
    }
  }, [open, initialData]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        basic_info: basicInfo,
        preferences,
        load_anchors: loadAnchors,
        physiological,
        psychological,
        fitness_level: fitnessLevel,
        red_flags: redFlags,
        modifiedBy: 'admin',
        changeReason: 'Admin manual update'
      });
      onClose();
    } catch (error: any) {
      setSaveError(error.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-white border-gray-200 text-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">编辑用户资料</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content - Single page layout with sections */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-8">
          {/* 区块 1: 体能状态 */}
          <PhysioSection
            basicInfo={basicInfo}
            setBasicInfo={setBasicInfo}
            fitnessLevel={fitnessLevel}
            setFitnessLevel={setFitnessLevel}
            redFlags={redFlags}
            setRedFlags={setRedFlags}
          />

          {/* 区块 2: 生理状态 */}
          <PhysiologicalSection
            physiological={physiological}
            setPhysiological={setPhysiological}
          />

          {/* 区块 3: 心理画像 */}
          <PsychologicalSection
            psychological={psychological}
            setPsychological={setPsychological}
          />

          {/* 区块 4: 偏好设置 */}
          <PreferencesSection
            preferences={preferences}
            setPreferences={setPreferences}
          />

          {/* 区块 5: 负荷锚点 */}
          {onOpenLoadAnchorsPage && (
            <LoadAnchorsSection
              loadAnchors={loadAnchors}
              onOpenAnchorPage={onOpenLoadAnchorsPage}
            />
          )}
        </div>

        {/* Footer */}
        {saveError && (
          <div className="px-6 py-2 bg-red-50 text-red-600 text-sm border-t border-red-100">
            {saveError}
          </div>
        )}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 bg-white">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          >
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} icon={<Save size={16} />}>
            {saving ? '保存中...' : '保存更改'}
          </Button>
        </div>
      </Card>
    </div>
  );
};
