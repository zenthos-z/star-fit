import React from 'react';
import { twMerge } from 'tailwind-merge';
import { X } from 'lucide-react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
  onRemove?: () => void;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className,
  onRemove
}) => {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-50 text-green-700 border border-green-100',
    warning: 'bg-yellow-50 text-yellow-700 border border-yellow-100',
    danger: 'bg-red-50 text-red-700 border border-red-100',
    info: 'bg-blue-50 text-blue-700 border border-blue-100',
    neutral: 'bg-gray-50 text-gray-600 border border-gray-100'
  };

  const sizes = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2.5 py-0.5'
  };

  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70 transition-opacity"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
};
