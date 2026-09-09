/** @type {import('tailwindcss').Config} */
export default {
  // CDN 时代两个入口各自的 inline tailwind.config 已合并至此（index.html + admin.html）
  darkMode: ['class'],
  content: [
    './index.html',
    './admin.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './storage/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'star-white': '#FAFAFA',
        'star-gray': '#F4F4F5',
        'star-dark': '#18181B',
        'star-accent': '#3B82F6',
        'admin-bg': '#0f172a',
        'admin-card': '#1e293b',
        'admin-border': '#334155',
        'admin-text': '#f1f5f9',
        'admin-muted': '#94a3b8',
      },
      boxShadow: {
        'white-model':
          '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02), 0 0 0 1px rgba(0,0,0,0.03)',
        floating:
          '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02)',
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            color: '#374151',
            p: {
              marginTop: '0.5em',
              marginBottom: '0.5em',
            },
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
