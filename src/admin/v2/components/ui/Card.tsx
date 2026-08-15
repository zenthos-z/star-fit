import React from 'react';
import { twMerge } from 'tailwind-merge';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  padding = 'md',
  hover = false
}) => {
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-5',
    lg: 'p-8'
  };

  return (
    <div 
      className={twMerge(
        'bg-white rounded-xl border border-gray-100 shadow-sm transition-all',
        hover && 'hover:shadow-md hover:border-gray-200',
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  );
};
