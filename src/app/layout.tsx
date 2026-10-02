import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';

import { Providers } from '@/components/providers';

import './globals.css';

// next/font self-hosts these at build time, so the CSP's `font-src 'self'`
// holds. Tailwind's font stacks fall back to system faces if they ever fail.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Display face for page and section titles (`font-serif`, h1/h2 by default).
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
});

// Used for timers, scores and attempt IDs, where tabular digits matter.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'SecureQuiz — Secure college examinations',
    template: '%s · SecureQuiz',
  },
  description:
    'Secure, fair and intelligent examinations for colleges. Server-authoritative exams with transparent integrity monitoring.',
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
    { media: '(prefers-color-scheme: light)', color: '#F5F4EF' },
    { media: '(prefers-color-scheme: dark)', color: '#121518' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
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
