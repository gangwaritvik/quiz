'use client';

import { MotionConfig } from 'framer-motion';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { RouterProvider } from 'react-aria-components';

import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside Providers.');
  return context;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>('light');

  React.useEffect(() => {
    const stored = window.localStorage.getItem('securequiz-theme');
    const nextTheme: Theme =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    setThemeState(nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, []);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    window.localStorage.setItem('securequiz-theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, []);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark') }),
    [setTheme, theme],
  );

  React.useEffect(() => {
    // Progressive enhancement only: the service worker caches the shell so a
    // brief drop-out does not blank the page. It never caches API responses,
    // which would risk showing a student a stale timer.
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('[securequiz] service worker registration failed', error);
      });
    };

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  // React Aria link items (e.g. menu items with an href) navigate client-side.
  const router = useRouter();

  return (
    <ThemeContext.Provider value={value}>
      <RouterProvider navigate={router.push}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </RouterProvider>
    </ThemeContext.Provider>
  );
}
