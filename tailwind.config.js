/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand colors - deep navy + electric green + amber accent
        brand: {
          50:  '#e8fff0',
          100: '#c0ffd6',
          200: '#80ffad',
          300: '#40ff84',
          400: '#00f55b',
          500: '#00dc52',
          600: '#00b843',
          700: '#008f34',
          800: '#006626',
          900: '#003d17',
          DEFAULT: '#00dc52',
        },
        surface: {
          0:   '#0a0f1a',
          1:   '#0f1623',
          2:   '#141d2d',
          3:   '#1a2638',
          4:   '#212f44',
          5:   '#293850',
          border: '#1e2d42',
        },
        text: {
          primary: '#f0f4ff',
          secondary: '#8ba3c7',
          muted: '#4a6080',
          inverse: '#0a0f1a',
        },
        accent: {
          amber: '#f59e0b',
          red: '#ef4444',
          blue: '#3b82f6',
          purple: '#8b5cf6',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui'],
        body: ['var(--font-body)', 'system-ui'],
        mono: ['var(--font-mono)', 'monospace'],
        stat: ['var(--font-stat)', 'system-ui'],
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'brand-sm': '0 0 0 1px rgba(0, 220, 82, 0.15), 0 2px 8px rgba(0, 220, 82, 0.1)',
        'brand-md': '0 0 0 1px rgba(0, 220, 82, 0.2), 0 4px 16px rgba(0, 220, 82, 0.15)',
        'brand-lg': '0 0 0 1px rgba(0, 220, 82, 0.25), 0 8px 32px rgba(0, 220, 82, 0.2)',
        'card': '0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'grid-surface': 'linear-gradient(rgba(30,45,66,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(30,45,66,0.5) 1px, transparent 1px)',
        'hero-gradient': 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(0,220,82,0.15) 0%, transparent 60%)',
        'card-gradient': 'linear-gradient(135deg, rgba(21,30,47,0.8) 0%, rgba(15,22,35,0.95) 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-brand': 'pulseBrand 2s ease-in-out infinite',
        'score-tick': 'scoreTick 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseBrand: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,220,82,0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(0,220,82,0)' },
        },
        scoreTick: {
          from: { transform: 'scale(1.3)', color: '#00dc52' },
          to: { transform: 'scale(1)', color: 'inherit' },
        },
      },
    },
  },
  plugins: [],
}
