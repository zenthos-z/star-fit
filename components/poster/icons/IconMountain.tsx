import React from 'react';

export const IconMountain: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 20L4 20L12 4L20 20Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 20L7 20L11.5 11L16 20Z" />
  </svg>
);
