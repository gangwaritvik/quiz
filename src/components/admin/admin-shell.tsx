'use client';

import {
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  FileQuestion,
  LayoutDashboard,
  Menu,
  MonitorPlay,
  Moon,
  PenLine,
  ShieldAlert,
  MessageSquare,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ConsoleSearch } from '@/components/admin/console-search';
import { Logo } from '@/components/brand/logo';
import { useTheme } from '@/components/providers';
import { UserMenu } from '@/components/shared/user-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApi } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: 'live' | 'flagged' | 'grading' | 'appeals';
}

/** Three groups answer "what am I doing": set things up, run an exam, look back. */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Teach',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/admin/quizzes', label: 'Quizzes', icon: BookOpen },
      { href: '/admin/questions', label: 'Question Bank', icon: FileQuestion },
      { href: '/admin/students', label: 'Students', icon: Users },
    ],
  },
  {
    label: 'Run',
    items: [
      { href: '/admin/live', label: 'Live Exams', icon: MonitorPlay, badge: 'live' },
      { href: '/admin/grading', label: 'Marking', icon: PenLine, badge: 'grading' },
      { href: '/admin/appeals', label: 'Appeals', icon: MessageSquare, badge: 'appeals' },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/admin/results', label: 'Results', icon: BarChart3 },
      { href: '/admin/integrity', label: 'Integrity Reports', icon: ShieldAlert, badge: 'flagged' },
    ],
  },
];

interface AdminShellProps {
  user: { name: string; email: string; department: string | null };
  children: React.ReactNode;
}

interface OverviewCounts {
  stats: {
    studentsTakingExams: number;
    flaggedAttempts: number;
    answersAwaitingMarking: number;
    openAppeals: number;
  };
}

export function AdminShell({ user, children }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { theme, toggleTheme } = useTheme();

  // Sidebar badges are live counts; they poll slowly so an idle dashboard is
  // not hammering the API.
  const { data } = useApi<OverviewCounts>('/api/admin/overview', { refreshInterval: 45_000 });

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  React.useEffect(() => setMobileOpen(false), [pathname]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      document.querySelector<HTMLElement>('[aria-controls="admin-mobile-nav"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const badgeFor = (kind?: 'live' | 'flagged' | 'grading' | 'appeals') => {
    if (!data) return null;
    if (kind === 'live' && data.stats.studentsTakingExams > 0) {
      return (
        <Badge variant="success" className="tabular ml-auto">
          {data.stats.studentsTakingExams}
        </Badge>
      );
    }
    if (kind === 'flagged' && data.stats.flaggedAttempts > 0) {
      return (
        <Badge variant="warning" className="tabular ml-auto">
          {data.stats.flaggedAttempts}
        </Badge>
      );
    }
    // Students are waiting on a real person for these, so the count is shown
    // as a standing prompt rather than only inside the screen itself.
    if (kind === 'appeals' && data.stats.openAppeals > 0) {
      return (
        <Badge variant="secondary" className="tabular ml-auto">
          {data.stats.openAppeals}
        </Badge>
      );
    }
    if (kind === 'grading' && data.stats.answersAwaitingMarking > 0) {
      return (
        <Badge variant="secondary" className="tabular ml-auto">
          {data.stats.answersAwaitingMarking}
        </Badge>
      );
    }
    return null;
  };

  // The sidebar and the drawer both render this, so heading ids carry a
  // per-instance prefix: aria-labelledby needs ids that are unique in the page.
  const navList = (idPrefix: string) => (
    <div className="space-y-5">
      {NAV_GROUPS.map((group) => {
        const headingId = `${idPrefix}-${group.label.toLowerCase()}`;
        return (
          <div key={group.label}>
            <p id={headingId} className="type-eyebrow mb-1.5 px-3">
              {group.label}
            </p>
            <ul aria-labelledby={headingId} className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, item.exact);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-standard [@media(pointer:coarse)]:min-h-11',
                        active
                          ? // Tint, weight and a marker bar: the active item does not rely on colour alone.
                            'bg-accent font-semibold text-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-primary'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      <item.icon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-primary' : 'text-muted-foreground',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{item.label}</span>
                      {badgeFor(item.badge)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="console-canvas flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
          <Link href="/admin" className="rounded-md" aria-label="SecureQuiz admin home">
            <Logo size="sm" />
          </Link>
        </div>

        {/* "Faculty console" now names the landmark instead of stacking a
            second eyebrow above the first group label. */}
        <nav aria-label="Faculty console" className="scrollbar-slim flex-1 overflow-y-auto px-3 py-5">
          {navList('nav-side')}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              aria-controls="admin-mobile-nav"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </Button>

            <Link href="/admin" className="rounded-md lg:hidden" aria-label="SecureQuiz admin home">
              <Logo size="sm" />
            </Link>

            <div className="hidden min-w-0 flex-1 md:block">
              <ConsoleSearch />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              {data && data.stats.studentsTakingExams > 0 ? (
                <Link
                  href="/admin/live"
                  className="mr-1 hidden h-10 items-center rounded-md sm:inline-flex"
                >
                  <Badge variant="success" className="tabular gap-1.5 px-2.5 py-1">
                    <span
                      className="size-1.5 animate-pulse-ring rounded-full bg-success"
                      aria-hidden
                    />
                    {data.stats.studentsTakingExams} taking exams
                  </Badge>
                </Link>
              ) : null}

              <NotificationBell
                flagged={data?.stats.flaggedAttempts ?? 0}
                marking={data?.stats.answersAwaitingMarking ?? 0}
                appeals={data?.stats.openAppeals ?? 0}
              />

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun /> : <Moon />}
              </Button>

              <UserMenu user={user} role="ADMIN" />
            </div>
          </div>

          <nav
            id="admin-mobile-nav"
            aria-label="Faculty console"
            hidden={!mobileOpen}
            className="scrollbar-slim max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border bg-card px-3 pb-4 pt-3 lg:hidden"
          >
            <div className="mb-3 md:hidden">
              <ConsoleSearch />
            </div>
            <div className="pl-3">{navList('nav-drawer')}</div>
          </nav>
        </header>

        {/* Pages set their own width and gutter with PageShell. */}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * What is waiting on this person, and nothing else.
 *
 * The dot appears only when there is genuinely something to act on, so it
 * never becomes the notification badge everybody learns to ignore.
 */
function NotificationBell({
  flagged,
  marking,
  appeals,
}: {
  flagged: number;
  marking: number;
  appeals: number;
}) {
  const items = [
    appeals > 0
      ? {
          key: 'appeals',
          href: '/admin/appeals',
          icon: MessageSquare,
          tone: 'text-warning',
          title: `${appeals} re-check request${appeals === 1 ? '' : 's'}`,
          detail: 'Students are waiting to hear back.',
        }
      : null,
    marking > 0
      ? {
          key: 'marking',
          href: '/admin/grading',
          icon: PenLine,
          tone: 'text-warning',
          title: `${marking} answer${marking === 1 ? '' : 's'} to mark`,
          detail: 'Those students are seeing a provisional score.',
        }
      : null,
    flagged > 0
      ? {
          key: 'flagged',
          href: '/admin/integrity',
          icon: ShieldAlert,
          tone: 'text-warning',
          title: `${flagged} attempt${flagged === 1 ? '' : 's'} flagged`,
          detail: 'Counts to look at in context, not conclusions.',
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    href: string;
    icon: typeof PenLine;
    tone: string;
    title: string;
    detail: string;
  }>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            items.length > 0
              ? `Notifications, ${items.length} waiting`
              : 'Notifications, none waiting'
          }
        >
          <Bell />
          {items.length > 0 ? (
            <span
              className="absolute right-2.5 top-2.5 size-2 rounded-full bg-warning ring-2 ring-background"
              aria-hidden
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-2rem))]">
        <DropdownMenuLabel>Needs your attention</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <div className="flex items-start gap-2.5 px-2 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Nothing waiting. No answers to mark and no attempts flagged for review.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.key} asChild>
              <Link href={item.href} className="items-start gap-2.5">
                <item.icon className={cn('mt-0.5 shrink-0', item.tone)} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
