/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0a0f14', 900: '#0f161d', 800: '#16202a', 700: '#1f2c38', 600: '#2b3b4a' },
        amber: { glow: '#ffb547' },
        cyanp: '#3fd0e0',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
