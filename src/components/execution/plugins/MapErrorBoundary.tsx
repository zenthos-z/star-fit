import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class MapErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('MapErrorBoundary caught an error:', error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      const errorMessage = this.state.error?.message || '未知错误';
      const isContainerReuseError = errorMessage.includes('Map container is being reused');
      const isAppendChildError = errorMessage.includes('appendChild');
      
      return (
        <div className="flex items-center justify-center h-full bg-gray-100 text-gray-500 p-4">
          <div className="text-center max-w-sm">
            <div className="text-sm font-medium mb-2">地图加载失败</div>
            {isContainerReuseError && (
              <div className="text-xs text-gray-400 mb-3">
                地图容器冲突，正在重新初始化...
              </div>
            )}
            {isAppendChildError && (
              <div className="text-xs text-gray-400 mb-3">
                地图容器未正确清理，请刷新页面重试
              </div>
            )}
            <button 
              onClick={this.handleRetry}
              className="px-4 py-2 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
