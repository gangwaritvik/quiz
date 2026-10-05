import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Colours are CSS variables (HSL channels) defined in src/app/globals.css.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          subtle: 'hsl(var(--success-subtle))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          subtle: 'hsl(var(--warning-subtle))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          foreground: 'hsl(var(--danger-foreground))',
          subtle: 'hsl(var(--danger-subtle))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      // Keys stay t-shirt sized so tailwind-merge treats them as font sizes.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem', { lineHeight: '1.625rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.875rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.375rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
        '5xl': ['3rem', { lineHeight: '3.5rem' }],
      },
      // Panels are separated by borders; shadows only on things that float.
      boxShadow: {
        xs: '0 1px 0 0 rgb(16 24 40 / 0.04)',
        sm: '0 1px 2px 0 rgb(16 24 40 / 0.06)',
        card: 'none',
        md: '0 2px 4px -1px rgb(16 24 40 / 0.06), 0 6px 16px -4px rgb(16 24 40 / 0.10)',
        lg: '0 4px 8px -2px rgb(16 24 40 / 0.06), 0 16px 32px -8px rgb(16 24 40 / 0.16)',
        elevated: '0 2px 4px -1px rgb(16 24 40 / 0.06), 0 6px 16px -4px rgb(16 24 40 / 0.10)',
        overlay: '0 0 0 1px rgb(16 24 40 / 0.04), 0 8px 16px -4px rgb(16 24 40 / 0.10), 0 24px 48px -12px rgb(16 24 40 / 0.18)',
      },
      transitionDuration: {
        DEFAULT: '120ms',
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)',
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 hsl(var(--success) / 0.5)' },
          '70%': { boxShadow: '0 0 0 6px hsl(var(--success) / 0)' },
          '100%': { boxShadow: '0 0 0 0 hsl(var(--success) / 0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s infinite',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.2, 0, 0, 1) infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
