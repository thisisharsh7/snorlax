import type { Config } from "tailwindcss";

export default {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: '#fafafa',   // lightest backgrounds
          100: '#f5f5f5',  // sidebar bg light
          150: '#ebebeb',  // hover states light (custom)
          200: '#e5e5e5',  // borders light
          300: '#d4d4d4',  // muted text light
          400: '#a3a3a3',  // secondary text
          500: '#737373',  // tertiary text
          600: '#525252',  // dark text light mode
          700: '#404040',  // headings
          800: '#262626',  // bg dark mode
          850: '#1f1f1f',  // hover states dark (custom)
          900: '#171717',  // sidebar bg dark
          950: '#0a0a0a',  // darkest backgrounds
        },
        accent: {
          blue: {
            50: '#eff6ff',
            100: '#dbeafe',
            400: '#60a5fa',  // primary focus
            600: '#2563eb',  // active
          },
          green: {
            50: '#f0fdf4',
            100: '#dcfce7',
            400: '#4ade80',  // success
            600: '#16a34a',
          },
          red: {
            50: '#fef2f2',
            100: '#fee2e2',
            400: '#f87171',  // error
            600: '#dc2626',  // delete hover
          },
          amber: {
            50: '#fffbeb',
            100: '#fef3c7',
            400: '#fbbf24',  // warning
            600: '#d97706',
          },
          purple: {
            50: '#faf5ff',
            100: '#f3e8ff',
            400: '#c084fc',  // special features
            600: '#9333ea',
          },
        },
      },
      fontSize: {
        'xs': ['0.6875rem', { lineHeight: '1rem' }],      // 11px
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],   // 13px
        'base': ['0.875rem', { lineHeight: '1.5rem' }],   // 14px (BASELINE)
        'md': ['0.9375rem', { lineHeight: '1.5rem' }],    // 15px
        'lg': ['1rem', { lineHeight: '1.5rem' }],         // 16px
        'xl': ['1.125rem', { lineHeight: '1.75rem' }],    // 18px
      },
      fontWeight: {
        normal: '400',
        medium: '500',   // primary emphasis
        semibold: '600', // headings only
      },
      borderRadius: {
        'sm': '0.25rem',  // 4px
        'md': '0.375rem', // 6px
        'lg': '0.5rem',   // 8px
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
