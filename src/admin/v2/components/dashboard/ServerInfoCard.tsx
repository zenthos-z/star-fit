/**
 * Server Info Card
 *
 * 显示服务器连接信息，前端生成二维码
 */

import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Smartphone, Copy, Check, QrCode, Globe } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface ServerInfoCardProps {
  serverInfo: {
    serverUrl: string;
    apiUrl: string;
  } | null;
}

export const ServerInfoCard: React.FC<ServerInfoCardProps> = ({ serverInfo }) => {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  if (!serverInfo) {
    return (
      <Card className="p-6">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serverInfo.serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-star-accent/5 to-transparent border-star-accent/20">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Smartphone size={20} className="text-star-accent" />
            前端 App 连接信息
          </h3>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Globe size={16} className="text-gray-400" />
              <span className="text-sm text-gray-500">服务器地址:</span>
              <code className="bg-white px-3 py-1.5 rounded-lg text-sm font-mono text-gray-900 border border-gray-200">
                {serverInfo.serverUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleCopy}
                title="复制地址"
              >
                {copied ? (
                  <Check size={16} className="text-green-500" />
                ) : (
                  <Copy size={16} className="text-gray-400" />
                )}
              </Button>
            </div>

            <p className="text-sm text-gray-500 pl-7">
              💡 新用户在手机上打开此地址即可注册登录
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQR(!showQR)}
          >
            <QrCode size={16} className="mr-1" />
            {showQR ? '隐藏' : '二维码'}
          </Button>

          {showQR && (
            <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-lg mt-2">
              <QRCodeSVG
                value={serverInfo.serverUrl}
                size={120}
                level="M"
                includeMargin={false}
              />
              <p className="text-xs text-center text-gray-400 mt-2">
                扫码访问
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
