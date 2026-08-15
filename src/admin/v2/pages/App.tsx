import React, { useState, useEffect } from 'react';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { Dashboard } from '../components/dashboard/Dashboard';
import { ActionList } from '../components/content/ActionList';
import { SettingsPage } from '../components/settings/SettingsPage';
import { UserManagementPage } from '../components/user/UserManagementPage';
import { Card } from '../components/ui/Card';
import { AdminService } from '../services/api';

interface User {
  id: string;
  session_count: number;
  created_at: number;
  device_id: string;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<any>(null);

  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) {
      loadUsers();
    }
  }, [activeTab]);

  useEffect(() => {
    AdminService.system
      .getCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const data = await AdminService.users.list();
      setUsers(data);
    } catch (error: any) {
      setUsersError(error.message || 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleUserDeleted = async () => {
    setSelectedUserId(null);
    await loadUsers();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onNavigate={setActiveTab} />;
      case 'content':
        return <ActionList />;
      case 'users':
        // Use the new UserManagementPage
        return (
          <UserManagementPage
            onOpenSettings={() => setActiveTab('settings')}
          />
        );
      case 'settings':
        return <SettingsPage />;
      default:
        return <div>Not implemented</div>;
    }
  };

  return (
    <div className="flex h-screen bg-star-white font-sans text-gray-900 overflow-hidden" data-testid="admin-app">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header title={
          activeTab === 'dashboard' ? '仪表盘' :
            activeTab === 'content' ? '内容库管理' :
              activeTab === 'users' ? '用户管理' : '系统设置'
        } />

        <main className={`flex-1 overflow-auto relative ${activeTab === 'users' || activeTab === 'content' ? 'p-0' : 'p-8'}`} data-testid="admin-main">
          <div className={`h-full ${activeTab === 'users' || activeTab === 'content' ? 'w-full' : 'max-w-7xl mx-auto'}`}>
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
};
