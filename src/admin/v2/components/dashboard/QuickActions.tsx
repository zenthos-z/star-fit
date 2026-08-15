/**
 * Quick Actions
 *
 * 快捷操作区
 */

import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
  Plus, 
  Download, 
  Settings, 
  Users, 
  BookOpen, 
  Video, 
  Activity 
} from 'lucide-react';
import { AdminService } from '../../services/api';

interface QuickActionsProps {
  onNavigate?: (tab: string) => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ onNavigate }) => {
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const handleCreateTestUser = async () => {
    setIsCreatingUser(true);
    try {
      // 生成测试用户数据
      const testUserId = `test-${Date.now()}`;
      const testUserData = {
        userId: testUserId,
        profile: {
          name: `测试用户-${Date.now().toString().slice(-4)}`,
          age: 25,
          gender: 'male',
          height: 175,
          weight: 70,
          fitness_goal: 'muscle_gain',
          fitness_level: 'intermediate',
        }
      };

      // 调用 API 创建用户画像
      await AdminService.users.updateProfile(testUserId, testUserData.profile as any);
      
      alert(`测试用户创建成功！\n用户ID: ${testUserId}`);
      
      // 跳转到用户管理页面
      if (onNavigate) {
        onNavigate('users');
      }
    } catch (error: any) {
      alert(`创建失败: ${error.message || '未知错误'}`);
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleExportData = () => {
    // 导出数据功能
    alert('导出功能开发中...');
  };

  const handleSettings = () => {
    if (onNavigate) {
      onNavigate('settings');
    }
  };

  const actions = [
    { 
      icon: Plus, 
      label: isCreatingUser ? '创建中...' : '创建测试用户', 
      onClick: handleCreateTestUser,
      disabled: isCreatingUser
    },
    { icon: Download, label: '导出数据', onClick: handleExportData },
    { icon: Settings, label: '系统设置', onClick: handleSettings },
  ];

  const handleNavigate = (tab: string) => {
    if (onNavigate) {
      onNavigate(tab);
    }
  };

  const links = [
    { icon: Users, label: '用户管理', tab: 'users' },
    { icon: BookOpen, label: '动作库', tab: 'content' },
    { icon: Video, label: '视频管理', tab: 'content' },
    { icon: Activity, label: 'MAS调试', tab: 'settings' },
  ];

  return (
    <Card className="p-6">
      <h3 className="font-bold text-gray-900 mb-4">快捷操作</h3>

      <div className="flex flex-wrap gap-3 mb-6">
        {actions.map((action, idx) => (
          <Button
            key={idx}
            variant="outline"
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            <action.icon size={16} className="mr-1" />
            {action.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {links.map((link, idx) => (
          <button
            key={idx}
            onClick={() => handleNavigate(link.tab)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-star-accent hover:bg-star-accent/5 rounded-lg transition-colors"
          >
            <link.icon size={14} />
            {link.label}
          </button>
        ))}
      </div>
    </Card>
  );
};
