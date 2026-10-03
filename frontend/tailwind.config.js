/** @type {import('tailwindcss').Config} */
// Palette: a printed topographic map. Paper and ink for interface, SAR orange for
// actions, forest green for secondary state; data colours live in the map itself.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: '#f4f0e6', 2: '#ebe5d6', 3: '#e1d9c6' },
        rule: { DEFAULT: '#d3c9b2', dark: '#3a443e' },
        ink: { DEFAULT: '#1e2420', 2: '#4a524c', 3: '#7b817a', 950: '#0d110f', 900: '#141a17', 800: '#1d2420', 700: '#283029', 600: '#36403a' },
        sar: { DEFAULT: '#d4521c', dark: '#a83c10', light: '#f2b38f' },
        forest: { DEFAULT: '#2d5a43', light: '#cfe0d3' },
        topo: '#8a5a33',
        prob: '#23b5c4',
      },
      fontFamily: {
        sans: ['Barlow', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Barlow', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '3px', sm: '2px', md: '4px', lg: '6px' },
      maxWidth: { prose: '68ch' },
    },
  },
  plugins: [],
};
