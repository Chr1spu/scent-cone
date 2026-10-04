/** @type {import('tailwindcss').Config} */
// Palette: "field kit". Warm paper and deep pine for interface, SAR orange (the handler's
// jumpsuit) for actions, scent amber and raincoat yellow as story accents. Interface colours
// are CSS variables (index.css) so `.theme-dark` (the planner) flips them in place.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: v('paper'), 2: v('paper-2'), 3: v('paper-3') },
        card: v('card'),
        rule: { DEFAULT: v('rule'), dark: '#2c3e37' },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 950: '#08110e', 900: '#0e1815', 800: '#16241f', 700: '#1f302a', 600: '#2c3e37' },
        sar: { DEFAULT: v('sar'), dark: v('sar-dark'), light: v('sar-light') },
        forest: { DEFAULT: v('forest'), light: v('forest-light') },
        pine: { DEFAULT: '#1f3b2f', 2: '#2b4d3d' },
        moss: '#5e8c4a',
        amber: '#ffb547',
        raincoat: '#f2c14e',
        dusk: '#3b2f63',
        sky: '#bfe3f2',
        topo: '#8a5a33',
        prob: '#23b5c4',
      },
      fontFamily: {
        sans: ['Barlow', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', 'Barlow', 'system-ui', 'sans-serif'],
        serif: ['Barlow', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '8px', sm: '6px', md: '10px', lg: '14px', xl: '20px', '2xl': '28px' },
      maxWidth: { prose: '68ch' },
      boxShadow: {
        lift: '0 1px 0 rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(19 33 28 / 0.25)',
        float: '0 24px 60px -24px rgb(8 17 14 / 0.55)',
        key: 'inset 0 -2px 0 rgb(0 0 0 / 0.18)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'none' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: { rise: 'rise .7s cubic-bezier(.2,.7,.2,1) both', pulseDot: 'pulseDot 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
