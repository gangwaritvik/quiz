'use client';

import { BookOpen, FileQuestion, Loader2, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/client/api';
import { cn } from '@/lib/utils';

interface Hit {
  id: string;
  title: string;
  subtitle: string;
}

interface SearchResults {
  quizzes: Hit[];
  students: Hit[];
  questions: Hit[];
}

const EMPTY: SearchResults = { quizzes: [], students: [], questions: [] };

/** Console-wide lookup. Navigates; it never renders scores or answer keys. */
export function ConsoleSearch() {
  const router = useRouter();
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Debounced, and every in-flight response is discarded if a newer keystroke
  // has already superseded it — otherwise a slow early request can overwrite
  // the results for what the user has since typed.
  React.useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResults>(
          `/api/admin/search?q=${encodeURIComponent(query)}`,
        );
        if (!cancelled) setResults(data);
      } catch {
        if (!cancelled) setResults(EMPTY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Ctrl/Cmd-K, the shortcut people already try.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const groups = [
    { key: 'quizzes', label: 'Quizzes', icon: BookOpen, items: results.quizzes, href: (id: string) => `/admin/quizzes/${id}` },
    { key: 'students', label: 'Students', icon: Users, items: results.students, href: () => `/admin/students` },
    { key: 'questions', label: 'Question bank', icon: FileQuestion, items: results.questions, href: () => `/admin/questions` },
  ] as const;

  const total = results.quizzes.length + results.students.length + results.questions.length;
  const showPanel = open && term.trim().length >= 2;

  const go = (href: string) => {
    setOpen(false);
    setTerm('');
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search quizzes, students, or anything…"
        aria-label="Search the console"
        className="h-10 bg-card pl-9 pr-12"
      />
      {loading ? (
        <Loader2
          className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-sm border border-border bg-muted px-1.5 py-px font-sans text-2xs font-medium text-muted-foreground sm:block">
          ⌘K
        </kbd>
      )}

      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay animate-in fade-in-0 duration-fast">
          {total === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {loading ? 'Searching…' : `Nothing matches “${term.trim()}”.`}
            </p>
          ) : (
            <div className="scrollbar-slim max-h-[min(26rem,70dvh)] overflow-y-auto p-1">
              {groups
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <div key={group.key} className="py-1">
                    <p className="type-eyebrow px-3 pb-1 pt-1.5">
                      {group.label}
                    </p>
                    <ul>
                      {group.items.map((hit) => (
                        <li key={hit.id}>
                          <button
                            type="button"
                            onClick={() => go(group.href(hit.id))}
                            className={cn(
                              'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors duration-fast ease-standard',
                              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-offset-[-2px]',
                            )}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                              <group.icon className="size-3.5" aria-hidden />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {hit.title}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {hit.subtitle}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
