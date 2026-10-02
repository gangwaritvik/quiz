'use client';

import { Laptop, X } from 'lucide-react';
import * as React from 'react';

import { useMediaQuery } from '@/hooks/use-api';

const DISMISS_KEY = 'securequiz.mobile-advisory-dismissed';

/**
 * Desktop is the supported exam environment. Rather than blocking small
 * screens — a student may only have a phone to check their timetable — we
 * advise once and let them dismiss it.
 */
export function MobileExamAdvisory() {
  const isSmall = useMediaQuery('(max-width: 767px)');
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!isSmall || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Storage unavailable — the notice simply reappears next navigation.
    }
  };

  return (
    <div
      role="status"
      className="mx-5 mt-5 flex items-start gap-3 rounded-md border border-warning/25 bg-warning-subtle py-1 pl-4 pr-1 sm:mx-8"
    >
      <Laptop className="mt-3 size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 py-2 text-sm leading-relaxed text-warning">
        For the best examination experience, use a laptop or desktop. Exams need a stable fullscreen
        window that phones cannot reliably provide.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-warning transition-colors duration-fast ease-standard hover:bg-warning/10"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
