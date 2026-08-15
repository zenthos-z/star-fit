/**
 * QRScanner - 二维码扫描组件
 *
 * Features:
 * - 使用 html5-qrcode 库实现摄像头扫码
 * - 支持启动/停止扫描
 * - 扫描成功后回调服务器地址
 * - 符合项目视觉规范
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (serverUrl: string) => void;
}

const QRScanner: React.FC<QRScannerProps> = ({ isOpen, onClose, onScan }) => {
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      startScanning();
    }

    return () => {
      stopScanning();
    };
  }, [isOpen]);

  const startScanning = async () => {
    if (!containerRef.current) return;

    setError('');
    setIsScanning(true);

    try {
      const scannerId = 'qr-scanner-container';
      scannerRef.current = new Html5Qrcode(scannerId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      });

      const cameras = await Html5Qrcode.getCameras();
      if (cameras.length === 0) {
        setError('未找到摄像头设备');
        setIsScanning(false);
        return;
      }

      // 优先使用后置摄像头
      const rearCamera = cameras.find(cam =>
        cam.label.toLowerCase().includes('back') ||
        cam.label.toLowerCase().includes('rear') ||
        cam.label.toLowerCase().includes('后置')
      );
      const selectedCamera = rearCamera || cameras[0];

      await scannerRef.current.start(
        selectedCamera.id,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          handleScanSuccess(decodedText);
        },
        () => {
          // 扫描中，忽略错误
        }
      );
    } catch (e) {
      setError('启动摄像头失败: ' + (e as Error).message);
      setIsScanning(false);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        // 忽略清理错误
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const handleScanSuccess = (decodedText: string) => {
    // 解析服务器地址
    const serverUrl = parseServerUrl(decodedText);
    if (serverUrl) {
      stopScanning();
      onScan(serverUrl);
      onClose();
    } else {
      setError('无效的二维码内容，请扫描服务器地址二维码');
    }
  };

  const parseServerUrl = (text: string): string | null => {
    const trimmed = text.trim();

    // 检查是否是完整URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    // 检查是否是 IP:Port 格式
    const ipPortRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/;
    const match = trimmed.match(ipPortRegex);
    if (match) {
      const port = match[2] || ':43111';
      return `http://${match[1]}${port}`;
    }

    // 检查是否只是IP地址
    const ipRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
    if (ipRegex.test(trimmed)) {
      return `http://${trimmed}:43111`;
    }

    return null;
  };

  const handleClose = async () => {
    await stopScanning();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-star-dark">
                  扫描二维码
                </h3>
                <button
                  onClick={handleClose}
                  className="p-2 rounded-xl text-gray-400 hover:text-star-dark hover:bg-star-gray transition-all"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-5 h-5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                对准服务器二维码自动扫描
              </p>
            </div>

            {/* Scanner Container */}
            <div className="px-6 pb-6">
              <div className="relative bg-black rounded-2xl overflow-hidden aspect-square">
                <div
                  id="qr-scanner-container"
                  ref={containerRef}
                  className="w-full h-full"
                />

                {/* Scanning Overlay */}
                {isScanning && (
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Corner Markers */}
                    <div className="absolute top-8 left-8 w-8 h-8 border-l-4 border-t-4 border-star-accent rounded-tl-lg" />
                    <div className="absolute top-8 right-8 w-8 h-8 border-r-4 border-t-4 border-star-accent rounded-tr-lg" />
                    <div className="absolute bottom-8 left-8 w-8 h-8 border-l-4 border-b-4 border-star-accent rounded-bl-lg" />
                    <div className="absolute bottom-8 right-8 w-8 h-8 border-r-4 border-b-4 border-star-accent rounded-br-lg" />

                    {/* Scan Line Animation */}
                    <motion.div
                      className="absolute left-8 right-8 h-0.5 bg-star-accent shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                      animate={{
                        top: ['20%', '80%', '20%'],
                      }}
                      transition={{
                        duration: 2.5,
                        repeat: Infinity,
                        ease: 'linear',
                      }}
                    />
                  </div>
                )}

                {/* Loading State */}
                {!isScanning && !error && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="w-8 h-8 text-white"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                        />
                      </svg>
                    </motion.div>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 bg-red-50 text-red-500 text-xs font-bold p-3 rounded-xl text-center"
                >
                  {error}
                </motion.div>
              )}

              {/* Tips */}
              <div className="mt-4 flex items-start gap-2 text-[10px] text-gray-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4 flex-shrink-0 mt-0.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zM8.25 9.75h.008v.008H8.25V9.75zm0 3h.008v.008H8.25V12.75z"
                  />
                </svg>
                <p>
                  二维码内容应为服务器地址，如：192.168.1.100 或 http://192.168.1.100:43111
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QRScanner;
