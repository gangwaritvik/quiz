import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * "Quiet Authority" — the SecureQuiz design system.
 *
 * Every colour is a CSS variable defined in `globals.css` (HSL channels, so
 * opacity modifiers like `bg-primary/10` work). Token *names* are stable; the
 * values are where the look lives.
 */
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
        /**
         * Oxford ink ramp (hue 214). `navy-800` is the primary; the darker
         * steps are for full-bleed dark surfaces (login showcase, exam
         * lock screens, camera frames). Name kept so existing classes resolve.
         */
        navy: {
          50: '#f0f4f9',
          100: '#dfe7f1',
          200: '#bfcfe3',
          300: '#93aecf',
          400: '#6187b5',
          500: '#3f6899',
          600: '#2e5180',
          700: '#24436c',
          800: '#1e3a5f',
          900: '#172c48',
          950: '#0e1b2e',
        },
      },
      /* 6px base: controls `rounded-md`, cards and dialogs `rounded-lg`. */
      borderRadius: {
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      /*
       * Type scale. Keys stay t-shirt sized so tailwind-merge recognises them
       * as font sizes (a `text-display` key would be mistaken for a colour and
       * silently dropped by `cn`). Line heights are set for reading, not
       * packing — students read these for an hour.
       */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem', { lineHeight: '1.625rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.875rem', letterSpacing: '-0.005em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }],
        '3xl': ['1.875rem', { lineHeight: '2.375rem', letterSpacing: '-0.015em' }],
        '4xl': ['2.25rem', { lineHeight: '2.75rem', letterSpacing: '-0.02em' }],
        '5xl': ['3rem', { lineHeight: '3.5rem', letterSpacing: '-0.02em' }],
      },
      /*
       * Surfaces are separated by hairlines, not shadows. Shadows are kept for
       * things that genuinely float: popovers, menus, dialogs, toasts.
       * `card` is intentionally flat.
       */
      boxShadow: {
        xs: '0 1px 0 0 rgb(23 25 30 / 0.04)',
        sm: '0 1px 2px 0 rgb(23 25 30 / 0.06)',
        card: 'none',
        md: '0 2px 4px -1px rgb(23 25 30 / 0.06), 0 6px 16px -4px rgb(23 25 30 / 0.10)',
        lg: '0 4px 8px -2px rgb(23 25 30 / 0.06), 0 16px 32px -8px rgb(23 25 30 / 0.16)',
        elevated: '0 2px 4px -1px rgb(23 25 30 / 0.06), 0 6px 16px -4px rgb(23 25 30 / 0.10)',
        overlay: '0 0 0 1px rgb(23 25 30 / 0.04), 0 8px 16px -4px rgb(23 25 30 / 0.10), 0 24px 48px -12px rgb(23 25 30 / 0.18)',
      },
      /*
       * Motion: two durations, one easing. `fast` for colour/press feedback,
       * `base` for overlays entering and leaving. tailwindcss-animate reads the
       * same scale, so `animate-in duration-base` works too. Reduced motion is
       * enforced globally in globals.css.
       */
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
