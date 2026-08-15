import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface AdminLayoutProps {
  children?: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="flex h-screen bg-star-white font-sans text-gray-900 overflow-hidden">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={
          activeTab === 'dashboard' ? '仪表盘' :
          activeTab === 'content' ? '内容库管理' :
          activeTab === 'users' ? '用户管理' : '系统设置'
        } />
        
        <main className="flex-1 overflow-auto p-8 relative">
          {/* Slot for page content */}
          <div className="max-w-7xl mx-auto h-full">
            {children || (
              <div className="flex items-center justify-center h-full text-gray-400">
                Placeholder for {activeTab}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
