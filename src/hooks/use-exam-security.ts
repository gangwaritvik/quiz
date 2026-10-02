'use client';

import * as React from 'react';

import { apiBeacon, apiFetch } from '@/lib/client/api';

export type SecurityEventType =
  | 'TAB_SWITCH'
  | 'WINDOW_BLUR'
  | 'WINDOW_FOCUS'
  | 'FULLSCREEN_ENTER'
  | 'FULLSCREEN_EXIT'
  | 'COPY_ATTEMPT'
  | 'PASTE_ATTEMPT'
  | 'CUT_ATTEMPT'
  | 'CONTEXT_MENU'
  | 'PRINT_ATTEMPT'
  | 'SHORTCUT_BLOCKED'
  | 'NETWORK_OFFLINE'
  | 'NETWORK_ONLINE'
  | 'CAMERA_PERMISSION_LOST'
  | 'CAMERA_STREAM_STOPPED'
  | 'FACE_NOT_DETECTED'
  | 'MULTIPLE_FACES'
  | 'MICROPHONE_LOST'
  | 'RESIZE_SUSPICIOUS'
  | 'IDLE_TIMEOUT'
  | 'MULTIPLE_DISPLAYS_DETECTED'
  | 'SCREEN_SHARE_STOPPED'
  | 'SCREEN_SHARE_PERMISSION_LOST';

interface QueuedEvent {
  type: SecurityEventType;
  durationMs?: number;
  clientTimestamp: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SecurityPolicy {
  requireFullscreen: boolean;
  detectTabSwitch: boolean;
  blockCopyPaste: boolean;
  maxFullscreenExits: number;
  blockMultipleDisplays?: boolean;
  requireScreenShare?: boolean;
}

export interface SecurityCounters {
  tabSwitches: number;
  fullscreenExits: number;
  blurEvents: number;
  copyPasteAttempts: number;
  networkDrops: number;
}

const EMPTY_COUNTERS: SecurityCounters = {
  tabSwitches: 0,
  fullscreenExits: 0,
  blurEvents: 0,
  copyPasteAttempts: 0,
  networkDrops: 0,
};

/** Shortcuts that would take a student out of the exam or open developer tools. */
function isRestrictedShortcut(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (key === 'f12') return 'F12';
  if (mod && event.shiftKey && ['i', 'j', 'c'].includes(key)) return `Ctrl+Shift+${key.toUpperCase()}`;
  if (mod && ['u', 's', 'p'].includes(key)) return `Ctrl+${key.toUpperCase()}`;
  if (mod && key === 'w') return 'Ctrl+W';
  if (event.altKey && key === 'tab') return 'Alt+Tab';
  if (mod && key === 'tab') return 'Ctrl+Tab';
  if (key === 'meta' || key === 'os') return 'System key';
  return null;
}

interface UseExamSecurityOptions {
  attemptId: string;
  policy: SecurityPolicy;
  /** Suspends all detection once the exam is submitted. */
  active: boolean;
  onFullscreenExit?: (exitCount: number) => void;
  onNetworkChange?: (online: boolean) => void;
  /**
   * Called immediately when the browser window loses focus (Alt+Tab, clicking
   * away, etc.). Use this to render a blocking overlay that hides exam content.
   *
   * Note: Alt+Tab cannot be intercepted by the browser before the OS handles
   * it, but the resulting window-blur fires synchronously and is the reliable
   * hook to blank the paper.
   */
  onWindowBlur?: () => void;
  /** Called when focus returns after a blur. */
  onWindowFocus?: () => void;
  /** Called when a secondary display or monitor is connected or disconnected. */
  onMultipleDisplaysChange?: (hasMultiple: boolean) => void;
}

/**
 * Browser-side exam monitoring.
 *
 * Important framing: none of this *prevents* determined cheating. A student can
 * disable JavaScript, use a second physical device, or patch the page. What it
 * does is (a) make casual shortcuts inconvenient, and (b) create an honest,
 * timestamped record on the server for a human to review. Every judgement about
 * that record is made by a teacher, not by this code.
 */
export function useExamSecurity({
  attemptId,
  policy,
  active,
  onFullscreenExit,
  onNetworkChange,
  onWindowBlur,
  onWindowFocus,
  onMultipleDisplaysChange,
}: UseExamSecurityOptions) {
  const queue = React.useRef<QueuedEvent[]>([]);
  const flushTimer = React.useRef<number | null>(null);
  const blurStartedAt = React.useRef<number | null>(null);
  const offlineStartedAt = React.useRef<number | null>(null);
  const exitCount = React.useRef(0);
  /**
   * True while a native file dialog is open. Opening one blurs the window
   * without hiding the document, so the resulting blur is annotated rather
   * than suppressed: it still reaches the server and still appears on the
   * timeline, but the integrity engine does not score it.
   */
  const filePickerOpen = React.useRef(false);

  const [counters, setCounters] = React.useState<SecurityCounters>(EMPTY_COUNTERS);
  const [fullscreenActive, setFullscreenActive] = React.useState(false);
  const [lastEventAt, setLastEventAt] = React.useState<Date | null>(null);
  /**
   * True while the exam window has the browser's focus. Flips to false the
   * instant the window is blurred (Alt+Tab, clicking another app, etc.) and
   * back to true when focus returns. The exam shell uses this to render a
   * blocking overlay so the paper is not readable while the student is away.
   */
  const [windowFocused, setWindowFocused] = React.useState(true);

  const activeRef = React.useRef(active);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const flush = React.useCallback(
    async (useBeacon = false) => {
      if (queue.current.length === 0) return;
      const events = queue.current.splice(0, 25);

      if (useBeacon) {
        // A page being unloaded cannot await a fetch; the beacon is the only
        // reliable way to land the final events.
        apiBeacon(`/api/exam/${attemptId}/events`, { events });
        return;
      }

      try {
        await apiFetch(`/api/exam/${attemptId}/events`, {
          method: 'POST',
          body: { events },
        });
      } catch {
        // Events are diagnostic, not transactional: re-queue once so a brief
        // outage does not lose them, but never block the exam on this.
        queue.current.unshift(...events.slice(0, 10));
      }
    },
    [attemptId],
  );

  const record = React.useCallback(
    (
      type: SecurityEventType,
      options: { durationMs?: number; metadata?: Record<string, string | number | boolean> } = {},
    ) => {
      if (!activeRef.current) return;

      queue.current.push({
        type,
        durationMs: options.durationMs,
        clientTimestamp: new Date().toISOString(),
        metadata: options.metadata,
      });
      setLastEventAt(new Date());

      setCounters((current) => {
        switch (type) {
          case 'TAB_SWITCH':
            return { ...current, tabSwitches: current.tabSwitches + 1 };
          case 'FULLSCREEN_EXIT':
            return { ...current, fullscreenExits: current.fullscreenExits + 1 };
          case 'WINDOW_BLUR':
            return { ...current, blurEvents: current.blurEvents + 1 };
          case 'COPY_ATTEMPT':
          case 'PASTE_ATTEMPT':
          case 'CUT_ATTEMPT':
            return { ...current, copyPasteAttempts: current.copyPasteAttempts + 1 };
          case 'NETWORK_OFFLINE':
            return { ...current, networkDrops: current.networkDrops + 1 };
          default:
            return current;
        }
      });

      // Send high-signal events immediately; batch the chatty ones.
      const urgent: SecurityEventType[] = [
        'PASTE_ATTEMPT',
        'PRINT_ATTEMPT',
        'MULTIPLE_FACES',
        'CAMERA_PERMISSION_LOST',
      ];
      if (urgent.includes(type) || queue.current.length >= 5) {
        void flush();
      }
    },
    [flush],
  );

  // Periodic flush so a quiet queue still reaches the server.
  React.useEffect(() => {
    if (!active) return;
    flushTimer.current = window.setInterval(() => void flush(), 8000);
    return () => {
      if (flushTimer.current) window.clearInterval(flushTimer.current);
    };
  }, [active, flush]);

  // --- Visibility, focus and fullscreen -----------------------------------
  React.useEffect(() => {
    if (!active) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        blurStartedAt.current = Date.now();
        setWindowFocused(false);
        onWindowBlur?.();
        if (policy.detectTabSwitch) record('TAB_SWITCH');
      } else if (blurStartedAt.current) {
        const durationMs = Date.now() - blurStartedAt.current;
        blurStartedAt.current = null;
        setWindowFocused(true);
        onWindowFocus?.();
        record('WINDOW_FOCUS', { durationMs });
      }
    };

    const handleBlur = () => {
      if (document.visibilityState === 'hidden') return; // already counted as a tab switch
      blurStartedAt.current = Date.now();
      setWindowFocused(false);
      onWindowBlur?.();
      record('WINDOW_BLUR', {
        ...(filePickerOpen.current ? { metadata: { context: 'file-picker' } } : {}),
      });
    };

    const handleFocus = () => {
      if (!blurStartedAt.current) return;
      const durationMs = Date.now() - blurStartedAt.current;
      blurStartedAt.current = null;
      setWindowFocused(true);
      onWindowFocus?.();
      record('WINDOW_FOCUS', { durationMs });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [active, policy.detectTabSwitch, record, onWindowBlur, onWindowFocus]);

  React.useEffect(() => {
    if (!active) return;

    let exitedAt: number | null = null;

    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      setFullscreenActive(isFullscreen);

      if (!isFullscreen && policy.requireFullscreen) {
        exitedAt = Date.now();
        // `record` owns the counter; the ref is what the callback reads, so the
        // notification never runs inside a state updater.
        exitCount.current += 1;
        record('FULLSCREEN_EXIT');
        onFullscreenExit?.(exitCount.current);
      } else if (isFullscreen && exitedAt) {
        record('FULLSCREEN_ENTER', { durationMs: Date.now() - exitedAt });
        exitedAt = null;
      }
    };

    setFullscreenActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [active, policy.requireFullscreen, record, onFullscreenExit]);

  // --- Clipboard, context menu, print, shortcuts --------------------------
  React.useEffect(() => {
    if (!active) return;

    const block = (event: Event, type: SecurityEventType) => {
      if (policy.blockCopyPaste) event.preventDefault();
      record(type);
    };

    const handleCopy = (event: ClipboardEvent) => block(event, 'COPY_ATTEMPT');
    const handlePaste = (event: ClipboardEvent) => block(event, 'PASTE_ATTEMPT');
    const handleCut = (event: ClipboardEvent) => block(event, 'CUT_ATTEMPT');

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      record('CONTEXT_MENU');
    };

    const handleBeforePrint = () => record('PRINT_ATTEMPT');

    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = isRestrictedShortcut(event);
      if (!shortcut) return;
      // Alt+Tab and the system key are handled by the OS before the browser
      // can intercept them, so preventDefault() has no effect there. We record
      // Alt+Tab as TAB_SWITCH (higher penalty) in addition to SHORTCUT_BLOCKED
      // so the server knows the attempt was deliberate, not an accidental blur.
      if (shortcut === 'Alt+Tab') {
        record('TAB_SWITCH', { metadata: { source: 'alt-tab-keydown' } });
      } else if (shortcut !== 'System key') {
        event.preventDefault();
      }
      record('SHORTCUT_BLOCKED', { metadata: { shortcut } });
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('cut', handleCut);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('beforeprint', handleBeforePrint);
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('cut', handleCut);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('beforeprint', handleBeforePrint);
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [active, policy.blockCopyPaste, record]);

  // --- Connectivity --------------------------------------------------------
  React.useEffect(() => {
    if (!active) return;

    const handleOffline = () => {
      offlineStartedAt.current = Date.now();
      record('NETWORK_OFFLINE');
      onNetworkChange?.(false);
    };

    const handleOnline = () => {
      const durationMs = offlineStartedAt.current ? Date.now() - offlineStartedAt.current : undefined;
      offlineStartedAt.current = null;
      record('NETWORK_ONLINE', { durationMs });
      onNetworkChange?.(true);
      void flush();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [active, record, flush, onNetworkChange]);

  // --- Multiple displays detection ---------------------------------------
  React.useEffect(() => {
    if (!active || !policy.blockMultipleDisplays) return;

    let previousExtended = false;

    const checkDisplays = () => {
      const isExtended = Boolean(
        (window.screen as unknown as { isExtended?: boolean }).isExtended ||
        (window.screen.availWidth > window.screen.width * 1.5)
      );

      if (isExtended !== previousExtended) {
        previousExtended = isExtended;
        onMultipleDisplaysChange?.(isExtended);
        if (isExtended) {
          record('MULTIPLE_DISPLAYS_DETECTED', {
            metadata: {
              screenCount: 'multiple',
              availWidth: window.screen.availWidth,
              width: window.screen.width,
            },
          });
        }
      }
    };

    checkDisplays();
    const interval = window.setInterval(checkDisplays, 3000);
    window.addEventListener('resize', checkDisplays);
    if ('screen' in window && 'addEventListener' in (window.screen as unknown as EventTarget)) {
      (window.screen as unknown as EventTarget).addEventListener('change', checkDisplays);
    }

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', checkDisplays);
      if ('screen' in window && 'removeEventListener' in (window.screen as unknown as EventTarget)) {
        (window.screen as unknown as EventTarget).removeEventListener('change', checkDisplays);
      }
    };
  }, [active, policy.blockMultipleDisplays, record, onMultipleDisplaysChange]);

  // --- Window resize (a shrunken window suggests a second app beside it) ----
  React.useEffect(() => {
    if (!active) return;

    let baseline = { width: window.innerWidth, height: window.innerHeight };
    let timeout: number | null = null;

    const handleResize = () => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        const shrunkBy = 1 - (window.innerWidth * window.innerHeight) / (baseline.width * baseline.height);
        if (shrunkBy > 0.3) {
          record('RESIZE_SUSPICIOUS', {
            metadata: { from: `${baseline.width}x${baseline.height}`, to: `${window.innerWidth}x${window.innerHeight}` },
          });
        }
        baseline = { width: window.innerWidth, height: window.innerHeight };
      }, 600);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [active, record]);

  // --- Final flush on unload ----------------------------------------------
  React.useEffect(() => {
    if (!active) return;
    const handleUnload = () => void flush(true);
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, [active, flush]);

  const enterFullscreen = React.useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      setFullscreenActive(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const exitFullscreen = React.useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Nothing to recover from; the exam is already finishing.
    }
  }, []);

  /**
   * Marks a file dialog as open or closed. Called by the upload control either
   * side of `input.click()`; the closing call is best-effort, since the browser
   * gives no event for a cancelled picker — the window regaining focus is the
   * only reliable signal, so it is cleared there too.
   */
  const setFilePickerOpen = React.useCallback((open: boolean) => {
    filePickerOpen.current = open;
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const clear = () => {
      filePickerOpen.current = false;
    };
    window.addEventListener('focus', clear);
    return () => window.removeEventListener('focus', clear);
  }, [active]);

  return {
    record,
    flush,
    counters,
    fullscreenActive,
    lastEventAt,
    enterFullscreen,
    exitFullscreen,
    setFilePickerOpen,
    /**
     * False while the browser window does not have focus (Alt+Tab, clicking
     * another app, etc.). The exam shell uses this to render a blocking overlay
     * that hides the exam paper until the student returns.
     */
    windowFocused,
    /** True when nothing has been flagged for this attempt so far. */
    clean:
      counters.tabSwitches === 0 &&
      counters.fullscreenExits === 0 &&
      counters.copyPasteAttempts === 0 &&
      counters.blurEvents === 0,
  };
}
