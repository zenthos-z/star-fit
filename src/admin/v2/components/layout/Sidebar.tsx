import React from 'react';
import { 
  LayoutDashboard, 
  Dumbbell, 
  Users, 
  Settings, 
  Activity,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, collapsed = false, onToggle }) => {
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: '仪表盘' },
    { id: 'content', icon: Dumbbell, label: '内容库' },
    { id: 'users', icon: Users, label: '用户管理' },
    { id: 'settings', icon: Settings, label: '系统设置' },
  ];

  return (
    <div className={`h-full bg-white border-r border-gray-100 flex flex-col flex-shrink-0 transition-all duration-300 ${collapsed ? 'w-20' : 'w-64'}`} data-testid="admin-sidebar">
      {/* Logo Area */}
      <div className="h-16 flex items-center border-b border-gray-100">
        <div className="flex items-center gap-2 flex-1 justify-center">
          <div className="bg-star-accent text-white p-1.5 rounded-lg">
            <Activity size={20} />
          </div>
          {!collapsed && (
            <span className="font-bold text-lg text-gray-900 tracking-tight">Starfit NAS</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            data-testid={`admin-tab-${item.id}`}
            title={collapsed ? item.label : undefined}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === item.id
                ? 'bg-star-accent/10 text-star-accent'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <item.icon size={18} />
            {!collapsed && item.label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-100">
        <button
          onClick={onToggle}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors`}
          title={collapsed ? '展开菜单' : '收起菜单'}
          data-testid="sidebar-toggle"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && '收起菜单'}
        </button>
      </div>
    </div>
  );
};
