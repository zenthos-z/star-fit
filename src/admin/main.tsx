import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './v2/pages/App';
import '../../index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);