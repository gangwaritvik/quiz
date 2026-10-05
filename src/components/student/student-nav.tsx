'use client';

import { Bell, Menu, Moon, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Logo } from '@/components/brand/logo';
import { useTheme } from '@/components/providers';
import { UserMenu } from '@/components/shared/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/quizzes', label: 'My Quizzes' },
  { href: '/results', label: 'Results' },
  { href: '/profile', label: 'Profile' },
];

interface StudentNavProps {
  user: {
    name: string;
    email: string;
    rollNumber: string | null;
    department: string | null;
    section: string | null;
  };
}

interface DashboardSummary {
  upcoming: Array<{ id: string; title: string; subject: string; startsAt: string; state: string }>;
  appealReplies?: Array<{
    id: string;
    status: 'UPHELD' | 'REJECTED';
    attemptId: string;
    title: string;
  }>;
}

const SEEN_REPLIES_KEY = 'sq-seen-appeal-replies';

function readSeenReplies(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_REPLIES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function StudentNav({ user }: StudentNavProps) {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Notifications reuse the dashboard feed rather than adding a second endpoint.
  const { data } = useApi<DashboardSummary>('/api/student/dashboard');
  const notifications = (data?.upcoming ?? []).filter(
    (quiz) => quiz.state === 'AVAILABLE' || quiz.state === 'IN_PROGRESS',
  );

  // Faculty answers to re-check requests stay in the bell until the menu is opened.
  const [seenReplies, setSeenReplies] = React.useState<string[]>([]);
  React.useEffect(() => setSeenReplies(readSeenReplies()), []);
  const replies = (data?.appealReplies ?? []).filter((reply) => !seenReplies.includes(reply.id));
  const bellCount = notifications.length + replies.length;
  const markRepliesSeen = (open: boolean) => {
    if (!open || replies.length === 0) return;
    const next = [...new Set([...seenReplies, ...replies.map((reply) => reply.id)])].slice(-50);
    try {
      localStorage.setItem(SEEN_REPLIES_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the replies simply show again next time.
    }
    // Kept visible for this opening; they drop out the next time the page loads.
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  React.useEffect(() => setMobileOpen(false), [pathname]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      document.querySelector<HTMLElement>('[aria-controls="student-mobile-nav"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5 sm:px-8 xl:gap-8">
        <Link href="/dashboard" className="shrink-0 rounded-md" aria-label="SecureQuiz home">
          <Logo size="sm" />
        </Link>

        <nav aria-label="Main" className="hidden h-full flex-1 items-stretch gap-1 lg:flex">
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center whitespace-nowrap px-3 text-sm font-medium transition-colors duration-fast ease-standard',
                  // The underline sits on the header's bottom border, like a tab.
                  'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors after:duration-fast',
                  active
                    ? 'text-foreground after:bg-primary'
                    : 'text-muted-foreground hover:text-foreground hover:after:bg-border',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu onOpenChange={markRepliesSeen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell />
                {bellCount > 0 ? (
                  <span
                    className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary ring-2 ring-card"
                    aria-hidden
                  />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))]">
              <DropdownMenuLabel className="flex items-center justify-between">
                Notifications
                {bellCount > 0 ? (
                  <Badge className="tabular">{bellCount}</Badge>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {bellCount === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              ) : (
                <ul className="max-h-72 overflow-y-auto py-1">
                  {replies.map((reply) => (
                    <li key={reply.id}>
                      <Link
                        href={`/results/${reply.attemptId}`}
                        className="flex min-h-11 flex-col justify-center gap-0.5 rounded-md px-2 py-2 transition-colors duration-fast ease-standard hover:bg-accent"
                      >
                        <span className="truncate text-sm font-medium text-foreground">
                          {reply.title}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {reply.status === 'UPHELD'
                            ? 'Your re-check was upheld'
                            : 'Your faculty replied to your re-check'}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {notifications.map((quiz) => (
                    <li key={quiz.id}>
                      <Link
                        href={`/quizzes/${quiz.id}`}
                        className="flex min-h-11 flex-col justify-center gap-0.5 rounded-md px-2 py-2 transition-colors duration-fast ease-standard hover:bg-accent"
                      >
                        <span className="truncate text-sm font-medium text-foreground">
                          {quiz.title}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {quiz.subject} ·{' '}
                          {quiz.state === 'IN_PROGRESS' ? 'Attempt in progress' : 'Open now'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <UserMenu user={user} role="STUDENT" />

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="student-mobile-nav"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      <nav
        id="student-mobile-nav"
        aria-label="Main"
        hidden={!mobileOpen}
        className="border-t border-border lg:hidden"
      >
        <ul className="mx-auto max-w-7xl space-y-0.5 px-3 py-2 sm:px-6">
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-11 items-center rounded-md px-3 text-[0.9375rem] font-medium transition-colors duration-fast ease-standard',
                    active
                      ? 'bg-accent text-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
