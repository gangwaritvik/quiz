'use client';

const DEVICE_KEY = 'securequiz.device-id';
const COOKIE_KEY = 'sq_did';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * A stable per-browser identifier.
 *
 * This is a *convenience* signal for session binding and the integrity report,
 * not a security control: a student can clear storage or edit the header. The
 * server treats it as one correlating input among several, which is why a
 * mismatch produces an event and a re-check rather than a silent trust
 * decision.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';

  try {
    const stored = window.localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;

    // Fall back to the cookie the server set, so clearing localStorage alone
    // does not look like a brand new device.
    const fromCookie = readCookie(COOKIE_KEY);
    if (fromCookie) {
      window.localStorage.setItem(DEVICE_KEY, fromCookie);
      return fromCookie;
    }

    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    window.localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    // Private browsing can throw on storage access; a per-tab id still lets the
    // request succeed, it just will not correlate across reloads.
    return readCookie(COOKIE_KEY) ?? 'unavailable-storage';
  }
}

/** Human-readable summary used by the pre-exam device check. */
export function describeEnvironment() {
  if (typeof window === 'undefined') {
    return { browser: 'Unknown', os: 'Unknown', screen: '', timezone: '' };
  }

  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Microsoft Edge'
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? 'Google Chrome'
      : /Firefox\//.test(ua)
        ? 'Mozilla Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Unknown browser';

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown OS';

  return {
    browser,
    os,
    screen: `${window.screen.width}×${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Browsers that can actually deliver a locked-down exam experience. */
export function isSupportedBrowser() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const modern = /Chrome\/|Firefox\/|Safari\/|Edg\//.test(ua);
  const hasFullscreen =
    typeof document.documentElement.requestFullscreen === 'function' ||
    'webkitRequestFullscreen' in document.documentElement;
  return modern && hasFullscreen;
}

export function isTouchPrimary() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
