import React from 'react';

export const IconBuilding: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M9 21V9l3-3 3 3v12M3 21V5l3-3 3 3v16M15 21V5l3-3 3 3v16" />
  </svg>
);
