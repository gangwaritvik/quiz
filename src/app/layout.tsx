import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

import { Providers } from '@/components/providers';

import './globals.css';

// next/font self-hosts these at build time, so the CSP's `font-src 'self'`
// holds. Tailwind's font stacks fall back to system faces if they ever fail.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Timers, scores, codes and attempt IDs.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'SecureQuiz',
    template: '%s · SecureQuiz',
  },
  description: 'Online examinations for colleges.',
  applicationName: 'SecureQuiz',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'SecureQuiz', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false }, // an examination portal should not be crawled
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/icon.svg' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F4F6' },
    { media: '(prefers-color-scheme: dark)', color: '#121417' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground">
        {/* First stop for keyboard users on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
