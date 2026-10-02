'use client';

import * as React from 'react';

import { ApiClientError, apiFetch } from '@/lib/client/api';

interface UseApiOptions {
  /** Poll interval in ms. Polling pauses while the tab is hidden. */
  refreshInterval?: number;
  /** Set false to defer the request (e.g. until an id is known). */
  enabled?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  error: ApiClientError | null;
  loading: boolean;
  /** True only for the first load, so lists can show skeletons once. */
  initialLoading: boolean;
  refetch: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Small data-fetching hook: loading, error and refetch without pulling in a
 * cache library. Deliberately does not retry automatically — the callers that
 * need retries (the exam client) manage their own backoff.
 */
export function useApi<T>(path: string | null, options: UseApiOptions = {}): UseApiResult<T> {
  const { refreshInterval, enabled = true } = options;

  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<ApiClientError | null>(null);
  const [loading, setLoading] = React.useState(Boolean(path) && enabled);
  const [initialLoading, setInitialLoading] = React.useState(Boolean(path) && enabled);

  // Guards against a slow response overwriting a newer one.
  const requestId = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!path || !enabled) return;

    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await apiFetch<T>(path);
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (id !== requestId.current) return;
      setError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError('SERVER_ERROR', 'Something went wrong.', 500),
      );
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [path, enabled]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!refreshInterval || !path || !enabled) return;

    const tick = () => {
      // A background tab does not need fresh invigilation data.
      if (document.visibilityState === 'visible') void load();
    };

    const timer = window.setInterval(tick, refreshInterval);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshInterval, load, path, enabled]);

  return { data, error, loading, initialLoading, refetch: load, setData };
}

/** Tracks browser connectivity for the "connection interrupted" banners. */
export function useOnlineStatus() {
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** Matches a media query, SSR-safe. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}
