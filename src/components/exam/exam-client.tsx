'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Expand,
  EyeOff,
  Loader2,
  LogOut,
  MonitorX,
  Megaphone,
  Pause,
  ScreenShare,
  TimerOff,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { CameraMonitor } from '@/components/exam/camera-monitor';
import { ExamTimerDisplay } from '@/components/exam/exam-timer';
import { QuestionNavigator } from '@/components/exam/question-navigator';
import {
  QuestionPanel,
  type AnswerChange,
  type ExamQuestion,
} from '@/components/exam/question-panel';
import { SecurityIndicator } from '@/components/exam/security-indicator';
import { SubmitDialog } from '@/components/exam/submit-dialog';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useExamSecurity } from '@/hooks/use-exam-security';
import { useExamTimer, type ExamTimer, type TimerSync } from '@/hooks/use-exam-timer';
import { ApiClientError, apiFetch, apiUpload } from '@/lib/client/api';
import { compressImage } from '@/lib/client/compress-image';
import {
  ackDraft,
  clearDrafts,
  getDraft,
  loadDrafts,
  saveDraft,
  type KV,
} from '@/lib/offline-queue';
import { extensionAdded, extensionMessage, readExtraMinutes } from '@/lib/timer-sync';
import { cn, formatDateTime } from '@/lib/utils';

/** What a save sends for one question. Only the fields for its type are set. */
interface AnswerPayload {
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  textResponse?: string | null;
}

/**
 * Whether a question counts as answered.
 *
 * The server computes this authoritatively and sends it on load; this mirrors
 * the same rule so the navigator and the counters update the instant a student
 * types, rather than waiting for a round trip.
 */
function isAnswered(question: ExamQuestion): boolean {
  switch (question.type) {
    case 'MCQ_MULTI':
      return question.selectedOptionIds.length > 0;
    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return Boolean(question.textResponse?.trim());
    case 'IMAGE_ANSWER':
      return question.attachments.length > 0;
    default:
      return Boolean(question.selectedOptionId);
  }
}

/** Typing should not fire a request per keystroke. */
const TEXT_SAVE_DEBOUNCE_MS = 800;

interface ExamState {
  attempt: { id: string; status: string; startedAt: string };
  quiz: {
    id: string;
    title: string;
    durationMinutes: number;
    questionCount: number;
    security: {
      requireFullscreen: boolean;
      detectTabSwitch: boolean;
      blockCopyPaste: boolean;
      bindDeviceSession: boolean;
      cameraMonitoring: boolean;
      microphoneMonitoring: boolean;
      maxFullscreenExits: number;
      lockQuestionNavigation: boolean;
      blockMultipleDisplays: boolean;
      requireScreenShare: boolean;
    };
  };
  questions: ExamQuestion[];
  timer: TimerSync;
  /** Total faculty extension in minutes; absent means none. */
  extraMinutes?: number;
  /** Faculty have paused this attempt. */
  paused?: boolean;
  /** Notices sent during this sitting. */
  notices?: ExamNotice[];
}

/** A short message from faculty to everyone sitting the quiz. */
interface ExamNotice {
  id: string;
  message: string;
  createdAt: string;
}

interface HeartbeatResponse {
  timer: TimerSync;
  extraMinutes?: number;
  paused?: boolean;
  notices?: ExamNotice[];
}

interface SubmitResult {
  attemptId: string;
  submittedAt: string;
  answered: number;
  total: number;
  autoSubmitted: boolean;
  resultsReleased: boolean;
  /** Set when results are held until the quiz window closes. */
  releasesAt?: string | null;
}

type Phase = 'loading' | 'active' | 'submitting' | 'submitted' | 'blocked';

const HEARTBEAT_MS = 20_000;
/** A request that has not finished by now counts as a dropped connection. */
const REQUEST_TIMEOUT_MS = 15_000;
const SUBMIT_TIMEOUT_MS = 30_000;

/** Auto-submit retry delays; after the list runs out, retry at the steady rate. */
const AUTO_SUBMIT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
const AUTO_SUBMIT_RETRY_MS = 10_000;
/** Spreads the buzzer so a whole room does not submit in the same second. */
const AUTO_SUBMIT_JITTER_MS = 3_000;

/** Where unsynced answers are kept across a reload or crash; null if the browser forbids storage. */
function draftStore(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function ExamClient({ attemptId }: { attemptId: string }) {
  const router = useRouter();

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [state, setState] = React.useState<ExamState | null>(null);
  const [questions, setQuestions] = React.useState<ExamQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [savedAtById, setSavedAtById] = React.useState<Record<string, number>>({});
  const [blockedError, setBlockedError] = React.useState<ApiClientError | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [submitResult, setSubmitResult] = React.useState<SubmitResult | null>(null);
  const [online, setOnline] = React.useState(true);
  const [connectionLost, setConnectionLost] = React.useState(false);
  /** Answers written but not yet confirmed by the server; shown while the connection is down. */
  const [unsentCount, setUnsentCount] = React.useState(0);
  const [cameraActive, setCameraActive] = React.useState<boolean | null>(null);
  const [microphoneActive, setMicrophoneActive] = React.useState<boolean | null>(null);
  const [screenShareActive, setScreenShareActive] = React.useState<boolean | null>(null);
  const [screenShareStream, setScreenShareStream] = React.useState<MediaStream | null>(null);
  const [screenShareStoppedCount, setScreenShareStoppedCount] = React.useState(0);
  const [multipleDisplaysDetected, setMultipleDisplaysDetected] = React.useState(false);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  /** Faculty have paused this attempt: the paper is covered and the clock is held. */
  const [paused, setPaused] = React.useState(false);
  const pausedRef = React.useRef(false);
  /** Notices from faculty still on screen, newest last. */
  const [notices, setNotices] = React.useState<ExamNotice[]>([]);
  const seenNoticeIds = React.useRef<Set<string>>(new Set());
  /** Server timestamp of the newest notice or state fetch; the heartbeat asks for anything since. */
  const noticeCursorRef = React.useRef<string | null>(null);
  /**
   * True while the browser window does not have focus. Drives the blocking
   * overlay that hides the exam paper whenever the student Alt+Tabs away or
   * clicks another app. The paper becomes readable again only after the student
   * returns and (if required) re-enters fullscreen.
   */
  const [focusLost, setFocusLost] = React.useState(false);
  /**
   * The highest question index reached so far in this session. Used to enforce
   * lockQuestionNavigation: students can only visit questions up to this index.
   */
  const [highestVisited, setHighestVisited] = React.useState(0);

  /**
   * Answers not yet confirmed by the server — either still inside the typing
   * debounce, or queued after a failed request. Submission drains this map, so
   * nothing a student wrote can be lost at the buzzer.
   */
  const pendingSaves = React.useRef<Map<string, AnswerPayload>>(new Map());
  const flushing = React.useRef(false);
  /** Lets the heartbeat (declared earlier) trigger a flush without a forward reference. */
  const flushQueueRef = React.useRef<() => void>(() => undefined);
  const debounceTimers = React.useRef<Map<string, number>>(new Map());
  const submitLock = React.useRef(false);
  const unmounted = React.useRef(false);
  /**
   * The timer object is new on every 250 ms tick. Effects and callbacks read it
   * through this ref so they are not torn down and rebuilt four times a second.
   */
  const timerRef = React.useRef<ExamTimer | null>(null);
  /** Null unless an auto-submit is running; otherwise its failed tries so far. */
  const [autoSubmitFailures, setAutoSubmitFailures] = React.useState<number | null>(null);
  /** The latest "faculty added time" notice; `dismissed` hides it but keeps the spoken text. */
  const [extension, setExtension] = React.useState<{ message: string; dismissed: boolean } | null>(
    null,
  );
  /** Total extension last reported by the server; null until the first state fetch. */
  const knownExtraRef = React.useRef<number | null>(null);
  const confirmingExpiry = React.useRef(false);

  const security = state?.quiz.security;
  const timerSync = state?.timer ?? null;

  // --- Time extensions -----------------------------------------------------
  // Called with each state / heartbeat response. The first call only records
  // the baseline; later increases raise one notice each. The countdown itself
  // is moved by the timer hook, never from here.
  const noteExtension = React.useCallback(
    (response: Parameters<typeof readExtraMinutes>[0], remainingMs: number) => {
      const { known, added } = extensionAdded(knownExtraRef.current, readExtraMinutes(response));
      knownExtraRef.current = known;
      if (added <= 0) return;

      const endsAt = formatDateTime(new Date(Date.now() + remainingMs), {
        day: undefined,
        month: undefined,
        year: undefined,
      });
      setExtension({ message: extensionMessage(added, endsAt), dismissed: false });
    },
    [],
  );

  // --- Pause and notices ---------------------------------------------------
  const applyPause = React.useCallback((next: boolean) => {
    pausedRef.current = next;
    setPaused(next);
  }, []);

  /** Shows notices not seen before; the cursor only moves forward. */
  const addNotices = React.useCallback((incoming: ExamNotice[]) => {
    const fresh = incoming.filter((notice) => !seenNoticeIds.current.has(notice.id));
    for (const notice of incoming) {
      if (!noticeCursorRef.current || notice.createdAt > noticeCursorRef.current) {
        noticeCursorRef.current = notice.createdAt;
      }
    }
    if (fresh.length === 0) return;
    for (const notice of fresh) seenNoticeIds.current.add(notice.id);
    setNotices((current) => [...current, ...fresh].slice(-3));
  }, []);

  /** One heartbeat: re-anchors the timer, notes any extension, returns the server's remaining ms. */
  const pingServer = React.useCallback(async () => {
    const result = await apiFetch<HeartbeatResponse>(`/api/exam/${attemptId}/heartbeat`, {
      method: 'POST',
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: noticeCursorRef.current ? { noticesSince: noticeCursorRef.current } : {},
    });
    timerRef.current?.sync(result.timer);
    noteExtension(result, result.timer.remainingMs);
    applyPause(Boolean(result.paused));
    addNotices(result.notices ?? []);
    return result.timer.remainingMs;
  }, [attemptId, noteExtension, applyPause, addNotices]);

  /**
   * Sends one answer with its draft sequence number, then acknowledges it. The
   * draft and the in-memory entry are removed only if they are still the ones
   * that were sent, so an edit made while this request was in flight survives.
   */
  const postAnswer = React.useCallback(
    async (attemptQuestionId: string, payload: AnswerPayload) => {
      const kv = draftStore();
      const clientSeq = getDraft<AnswerPayload>(kv, attemptId, attemptQuestionId)?.seq;
      const result = await apiFetch<{ timer: { remainingMs: number; serverNow: string } }>(
        `/api/exam/${attemptId}/answer`,
        { method: 'POST', body: { attemptQuestionId, ...payload, clientSeq }, timeoutMs: REQUEST_TIMEOUT_MS },
      );
      ackDraft(kv, attemptId, attemptQuestionId, clientSeq);
      if (pendingSaves.current.get(attemptQuestionId) === payload) {
        pendingSaves.current.delete(attemptQuestionId);
      }
      return result;
    },
    [attemptId],
  );

  // --- Submission ---------------------------------------------------------
  const submit = React.useCallback(
    async (auto = false) => {
      if (submitLock.current) return;
      submitLock.current = true;
      setPhase('submitting');
      if (auto) {
        setAutoSubmitFailures(0);
        await sleep(Math.random() * AUTO_SUBMIT_JITTER_MS);
      }

      for (let failures = 0; ; failures++) {
        try {
          // Cancel pending debounces; their payloads are already in the queue
          // below, so waiting for the timers would only delay submission.
          for (const timer of debounceTimers.current.values()) window.clearTimeout(timer);
          debounceTimers.current.clear();

          // Flush anything still queued so no answer is lost at the buzzer.
          // An answer that could not be sent holds the submission back (it is
          // retried), unless the server says the attempt is already over, in
          // which case it can never be saved and is dropped.
          let unsent = false;
          for (const [attemptQuestionId, payload] of [...pendingSaves.current]) {
            try {
              await postAnswer(attemptQuestionId, payload);
            } catch (caught) {
              if (caught instanceof ApiClientError && caught.code === 'ATTEMPT_EXPIRED') {
                pendingSaves.current.delete(attemptQuestionId);
              } else {
                unsent = true;
              }
            }
          }
          if (unsent) {
            throw new ApiClientError(
              'NETWORK',
              'Some of your latest answers have not reached the server yet. Check your connection; they are kept on this device, and you can submit again once they are sent.',
              0,
            );
          }

          // Idempotent server-side: an already-submitted attempt returns its receipt.
          const result = await apiFetch<SubmitResult>(`/api/exam/${attemptId}/submit`, {
            method: 'POST',
            body: { confirm: true },
            timeoutMs: SUBMIT_TIMEOUT_MS,
          });

          clearDrafts(draftStore(), attemptId);
          setSubmitResult(result);
          setPhase('submitted');
          setSubmitOpen(false);
          setAutoSubmitFailures(null);
          if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
          if (auto) toast.warning('Time expired — your exam was submitted automatically.');
          return;
        } catch (caught) {
          const error = caught instanceof ApiClientError ? caught : null;
          // A manual submit that fails after the buzzer becomes an auto-submit:
          // the timer has already fired, so nothing else would retry it.
          if (!auto && timerRef.current?.expired) {
            auto = true;
            setSubmitOpen(false);
          }
          // ATTEMPT_EXPIRED means the server finalised it; the next try returns the receipt.
          const retryable =
            !error ||
            error.isTransient ||
            error.code === 'RATE_LIMITED' ||
            error.code === 'ATTEMPT_EXPIRED';

          if (auto && retryable) {
            if (unmounted.current) return;
            setAutoSubmitFailures(failures + 1);
            await sleep(AUTO_SUBMIT_BACKOFF_MS[failures] ?? AUTO_SUBMIT_RETRY_MS);
            if (unmounted.current) return;
            continue;
          }

          setAutoSubmitFailures(null);
          if (auto && error) {
            // Retrying cannot fix this (session or device no longer checks out).
            setBlockedError(error);
            setPhase('blocked');
            return;
          }
          submitLock.current = false;
          setPhase('active');
          toast.error(error?.message ?? 'We could not submit your exam.', { duration: 8000 });
          return;
        }
      }
    },
    [attemptId, postAnswer],
  );

  /**
   * The local timer reached zero. Our clock may simply have run ahead of the
   * server's, or faculty may have just added time, so ask the server before
   * submitting. The server decides: a larger remaining time re-anchors the
   * countdown and nothing is submitted; "expired" (ATTEMPT_EXPIRED, or no time
   * left) proceeds to the auto-submit above, with all of its retry and jitter.
   * While the server cannot be reached the answer is unknown, so keep asking
   * at the auto-submit pace rather than submit an attempt that may have been
   * extended. The server refuses late answers either way.
   */
  const confirmThenSubmit = React.useCallback(async () => {
    if (confirmingExpiry.current) return;
    confirmingExpiry.current = true;
    try {
      for (let failures = 0; ; failures++) {
        try {
          const remainingMs = await pingServer();
          setConnectionLost(false);
          if (remainingMs > 0) return;
          break;
        } catch (caught) {
          const error = caught instanceof ApiClientError ? caught : null;
          const unreachable = !error || error.isTransient || error.code === 'RATE_LIMITED';
          // ATTEMPT_EXPIRED, or a hard failure that submit() will surface.
          if (!unreachable) break;

          setConnectionLost(true);
          await sleep(AUTO_SUBMIT_BACKOFF_MS[failures] ?? AUTO_SUBMIT_RETRY_MS);
          // A heartbeat meanwhile may have extended the timer.
          if (unmounted.current || !timerRef.current?.expired) return;
        }
      }
    } finally {
      confirmingExpiry.current = false;
    }
    void submit(true);
  }, [pingServer, submit]);

  const timer = useExamTimer(timerSync, (lastServerRemainingMs) => {
    if (phase !== 'active') return;
    // The server's last word was already "no time left": nothing to confirm.
    if (lastServerRemainingMs !== null && lastServerRemainingMs <= 0) void submit(true);
    else void confirmThenSubmit();
  }, paused);
  timerRef.current = timer;

  // --- Security monitoring -------------------------------------------------
  // The hook lists these callbacks as effect dependencies, and this component
  // re-renders on every timer tick: inline arrows would re-run those effects
  // (resetting the 3 s display check and its state) four times a second.
  const maxFullscreenExits = security?.maxFullscreenExits ?? 3;
  const requireFullscreen = security?.requireFullscreen ?? false;
  const blockMultipleDisplays = security?.blockMultipleDisplays ?? false;

  const onFullscreenExit = React.useCallback(
    (count: number) => {
      toast.warning(
        count >= maxFullscreenExits
          ? 'You have left fullscreen several times. This has been recorded for your faculty.'
          : 'Please return to fullscreen to continue your exam.',
      );
    },
    [maxFullscreenExits],
  );
  const onNetworkChange = React.useCallback((isOnline: boolean) => {
    setOnline(isOnline);
    if (!isOnline) {
      setConnectionLost(true);
    } else {
      toast.success('Connection restored. Sending your latest answers.');
    }
  }, []);
  const onWindowBlur = React.useCallback(() => {
    // Hide the exam paper immediately. The student cannot read questions
    // while their attention is on another window.
    setFocusLost(true);
  }, []);
  const onWindowFocus = React.useCallback(() => {
    setFocusLost(false);
    // If fullscreen is required, silently re-request it so the student
    // cannot bypass the fullscreen gate by Alt+Tabbing out and back in.
    if (requireFullscreen) {
      void document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .catch(() => undefined);
    }
  }, [requireFullscreen]);
  const onMultipleDisplaysChange = React.useCallback(
    (hasMultiple: boolean) => {
      setMultipleDisplaysDetected(hasMultiple);
      if (hasMultiple && blockMultipleDisplays) {
        toast.error('Multiple displays detected. Please disconnect secondary monitors to continue.');
      }
    },
    [blockMultipleDisplays],
  );

  const examSecurity = useExamSecurity({
    attemptId,
    active: phase === 'active',
    policy: {
      requireFullscreen,
      detectTabSwitch: security?.detectTabSwitch ?? false,
      blockCopyPaste: security?.blockCopyPaste ?? false,
      maxFullscreenExits,
      blockMultipleDisplays,
      requireScreenShare: security?.requireScreenShare ?? false,
    },
    onFullscreenExit,
    onNetworkChange,
    onWindowBlur,
    onWindowFocus,
    onMultipleDisplaysChange,
  });
  const recordEvent = examSecurity.record;

  // --- Screen share handling -----------------------------------------------
  const requestScreenShare = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Screen sharing is not supported by your browser.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track returned');

      const settings = track.getSettings?.();
      if (settings?.displaySurface && settings.displaySurface !== 'monitor') {
        track.stop();
        stream.getTracks().forEach((t) => t.stop());
        setScreenShareActive(false);
        setScreenShareStream(null);
        toast.error('Window or tab sharing is not permitted. You must select "Entire Screen" to resume the exam.', { duration: 6000 });
        return false;
      }

      setScreenShareStream(stream);
      setScreenShareActive(true);
      toast.success('Entire screen shared successfully.');

      track.addEventListener('ended', () => {
        setScreenShareActive(false);
        setScreenShareStream(null);
        setScreenShareStoppedCount((prev) => prev + 1);
        recordEvent('SCREEN_SHARE_STOPPED');
        toast.error('Screen sharing was stopped! You must resume sharing your screen to continue the examination.', { duration: 9000 });
      });

      return true;
    } catch {
      setScreenShareActive(false);
      setScreenShareStream(null);
      recordEvent('SCREEN_SHARE_PERMISSION_LOST');
      toast.error('Screen share permission was denied or cancelled. You must grant entire-screen access to view the exam.', { duration: 6000 });
      return false;
    }
  }, [recordEvent]);

  React.useEffect(() => {
    if (phase === 'active' && security?.requireScreenShare && screenShareActive === null) {
      void requestScreenShare();
    }
  }, [phase, security?.requireScreenShare, screenShareActive, requestScreenShare]);

  React.useEffect(() => {
    return () => {
      screenShareStream?.getTracks().forEach((track) => track.stop());
    };
  }, [screenShareStream]);

  // --- Initial load --------------------------------------------------------
  const load = React.useCallback(async () => {
    try {
      const result = await apiFetch<ExamState>(`/api/exam/${attemptId}/state`);

      // Answers typed in an earlier session that never reached the server
      // (closed laptop, crashed tab) come back from this device's drafts, and
      // are sent once the paper is up. The server drops any that are stale.
      const drafts = loadDrafts<AnswerPayload>(draftStore(), attemptId);
      const questionsWithDrafts = result.questions.map((question) => {
        const draft = drafts[question.attemptQuestionId];
        if (!draft) return question;
        pendingSaves.current.set(question.attemptQuestionId, draft.payload);
        return { ...question, ...draft.payload };
      });

      setState(result);
      applyPause(Boolean(result.paused));
      noticeCursorRef.current = result.timer.serverNow;
      addNotices(result.notices ?? []);
      setQuestions(questionsWithDrafts);
      setPhase('active');
      noteExtension(result, result.timer.remainingMs);

      // Resume where the student left off: first unanswered question. The
      // server decides what "answered" means for each type.
      const firstUnanswered = result.questions.findIndex((q) => !q.answered);
      setCurrentIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
    } catch (caught) {
      const error =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError('SERVER_ERROR', 'We could not load your exam.', 500);

      // An already-submitted attempt is not an error worth a scary screen.
      if (error.code === 'ATTEMPT_EXPIRED') {
        router.replace(`/results/${attemptId}`);
        return;
      }

      setBlockedError(error);
      setPhase('blocked');
    }
  }, [attemptId, router, noteExtension, applyPause, addNotices]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setOnline(navigator.onLine);
  }, []);

  // The queue lives in a ref, so while the connection is down read its size once a second.
  React.useEffect(() => {
    if (!connectionLost) {
      setUnsentCount(0);
      return;
    }
    const tick = () => setUnsentCount(pendingSaves.current.size);
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [connectionLost]);

  // --- Heartbeat: liveness plus authoritative time sync --------------------
  // Runs for the whole 'active' phase, including while a gate (fullscreen,
  // focus, screen share) covers the paper. Reads the timer through a ref so
  // the interval is created once per phase, not every tick.
  React.useEffect(() => {
    if (phase !== 'active') return;

    const beat = async () => {
      try {
        await pingServer();
        setConnectionLost(false);
        // The server is reachable: send anything that was waiting.
        flushQueueRef.current();
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.code === 'ATTEMPT_EXPIRED') {
          void submit(true);
          return;
        }
        if (
          caught instanceof ApiClientError &&
          !caught.isTransient &&
          caught.code !== 'RATE_LIMITED'
        ) {
          // A hard failure here means the session or device no longer checks
          // out; stop the exam rather than letting it drift on.
          setBlockedError(caught);
          setPhase('blocked');
          return;
        }
        setConnectionLost(true);
      }
    };

    const interval = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [phase, submit, pingServer]);

  // --- Answer persistence --------------------------------------------------
  const persistAnswer = React.useCallback(
    async (attemptQuestionId: string, payload: AnswerPayload) => {
      setSavingIds((current) => new Set(current).add(attemptQuestionId));

      try {
        const result = await postAnswer(attemptQuestionId, payload);
        setSavedAtById((current) => ({ ...current, [attemptQuestionId]: Date.now() }));
        setConnectionLost(false);
        timerRef.current?.sync({
          remainingMs: result.timer.remainingMs,
          serverNow: result.timer.serverNow,
          expiresAt: new Date(Date.now() + result.timer.remainingMs).toISOString(),
        });
      } catch (caught) {
        const error = caught instanceof ApiClientError ? caught : null;

        if (error?.code === 'ATTEMPT_EXPIRED') {
          toast.warning('Time is up — your exam has been submitted.');
          void submit(true);
          return;
        }

        if (error?.code === 'PAUSED') {
          // Faculty paused the attempt: keep the answer, it is sent on resume.
          pendingSaves.current.set(attemptQuestionId, payload);
          applyPause(true);
          return;
        }

        if (error && !error.isTransient && error.code !== 'RATE_LIMITED') {
          setBlockedError(error);
          setPhase('blocked');
          return;
        }

        // Transient: keep the answer locally and retry on the next change or
        // at submission. The student is told their work is safe.
        pendingSaves.current.set(attemptQuestionId, payload);
        setConnectionLost(true);
      } finally {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(attemptQuestionId);
          return next;
        });
      }
    },
    // No `timer` here: it changes every tick, which re-fired the retry effect
    // below (re-sending queued answers) four times a second.
    [submit, postAnswer, applyPause],
  );

  /** Sends every queued answer, one at a time; a second call while one runs does nothing. */
  const flushQueue = React.useCallback(async () => {
    if (flushing.current || pausedRef.current) return;
    flushing.current = true;
    try {
      for (const [attemptQuestionId, payload] of [...pendingSaves.current]) {
        // A debounce still running will send its own, newer payload.
        if (debounceTimers.current.has(attemptQuestionId)) continue;
        await persistAnswer(attemptQuestionId, payload);
      }
    } finally {
      flushing.current = false;
    }
  }, [persistAnswer]);
  flushQueueRef.current = () => void flushQueue();

  // Retry queued answers as soon as connectivity returns, and once the paper
  // has loaded (answers recovered from a previous session wait in the queue).
  React.useEffect(() => {
    if (!online || phase !== 'active' || pendingSaves.current.size === 0) return;
    void flushQueue();
  }, [online, phase, flushQueue]);

  /**
   * Applies a change optimistically, then saves it.
   *
   * Choices save immediately; typing is debounced so an essay does not produce
   * a request per keystroke. Either way the payload lands in `pendingSaves`
   * first, so an answer is recoverable at submission even if its request never
   * completes.
   */
  const handleAnswerChange = React.useCallback(
    (change: AnswerChange) => {
      const question = questions[currentIndex];
      if (!question) return;
      const id = question.attemptQuestionId;

      let payload: AnswerPayload;
      let patch: Partial<ExamQuestion>;

      if (change.kind === 'option') {
        payload = { selectedOptionId: change.selectedOptionId };
        patch = { selectedOptionId: change.selectedOptionId };
      } else if (change.kind === 'options') {
        payload = { selectedOptionIds: change.selectedOptionIds };
        patch = { selectedOptionIds: change.selectedOptionIds };
      } else {
        payload = { textResponse: change.textResponse };
        patch = { textResponse: change.textResponse };
      }

      setQuestions((current) =>
        current.map((q, index) => (index === currentIndex ? { ...q, ...patch } : q)),
      );
      pendingSaves.current.set(id, payload);
      saveDraft(draftStore(), attemptId, id, payload);

      const existingTimer = debounceTimers.current.get(id);
      if (existingTimer) window.clearTimeout(existingTimer);

      if (change.kind === 'text') {
        const timer = window.setTimeout(() => {
          debounceTimers.current.delete(id);
          void persistAnswer(id, payload);
        }, TEXT_SAVE_DEBOUNCE_MS);
        debounceTimers.current.set(id, timer);
      } else {
        void persistAnswer(id, payload);
      }
    },
    [attemptId, currentIndex, questions, persistAnswer],
  );

  /** Saves any debounced text immediately — used when leaving a question. */
  const flushPendingText = React.useCallback(() => {
    for (const [id, timer] of debounceTimers.current) {
      window.clearTimeout(timer);
      debounceTimers.current.delete(id);
      const payload = pendingSaves.current.get(id);
      if (payload) void persistAnswer(id, payload);
    }
  }, [persistAnswer]);

  const goToQuestion = React.useCallback(
    (next: number) => {
      // When navigation is locked, students may only go forward (to a question
      // index they have not visited before). Going back is blocked entirely.
      if (security?.lockQuestionNavigation && next < currentIndex) return;
      flushPendingText();
      setCurrentIndex(next);
      setHighestVisited((prev) => Math.max(prev, next));
    },
    [flushPendingText, security?.lockQuestionNavigation, currentIndex],
  );

  // --- Answer attachments --------------------------------------------------
  const uploadAttachment = React.useCallback(
    async (file: File) => {
      const question = questions[currentIndex];
      if (!question) return;
      const id = question.attemptQuestionId;

      setUploadingId(id);
      try {
        // A phone photo is often several MB; shrink it so it uploads quickly and fits the limit.
        const photo = await compressImage(file, { maxSide: 1920, quality: 0.82 });
        const result = await apiUpload<{
          attachment: { id: string; url: string; name: string };
        }>(`/api/exam/${attemptId}/attachments`, (() => {
          const form = new FormData();
          form.append('file', photo);
          form.append('attemptQuestionId', id);
          return form;
        })());

        setQuestions((current) =>
          current.map((q) =>
            q.attemptQuestionId === id
              ? { ...q, attachments: [...q.attachments, result.attachment] }
              : q,
          ),
        );
        setConnectionLost(false);
      } catch (caught) {
        const message =
          caught instanceof ApiClientError ? caught.message : 'We could not upload that image.';
        toast.error(message, { duration: 7000 });
      } finally {
        setUploadingId(null);
      }
    },
    [attemptId, currentIndex, questions],
  );

  const removeAttachment = React.useCallback(
    async (attachmentId: string) => {
      const question = questions[currentIndex];
      if (!question) return;
      const id = question.attemptQuestionId;
      const previous = question.attachments;

      // Optimistic removal, restored if the request fails.
      setQuestions((current) =>
        current.map((q) =>
          q.attemptQuestionId === id
            ? { ...q, attachments: q.attachments.filter((a) => a.id !== attachmentId) }
            : q,
        ),
      );

      try {
        await apiFetch(`/api/exam/${attemptId}/attachments/${attachmentId}`, {
          method: 'DELETE',
        });
      } catch (caught) {
        setQuestions((current) =>
          current.map((q) => (q.attemptQuestionId === id ? { ...q, attachments: previous } : q)),
        );
        const message =
          caught instanceof ApiClientError ? caught.message : 'We could not remove that image.';
        toast.error(message);
      }
    },
    [attemptId, currentIndex, questions],
  );

  const toggleReview = async () => {
    const question = questions[currentIndex];
    if (!question) return;

    const next = !question.markedForReview;
    setQuestions((current) =>
      current.map((q, index) => (index === currentIndex ? { ...q, markedForReview: next } : q)),
    );

    try {
      await apiFetch(`/api/exam/${attemptId}/flag`, {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUT_MS,
        body: { attemptQuestionId: question.attemptQuestionId, markedForReview: next },
      });
    } catch {
      // Flags are a convenience; revert quietly rather than interrupting.
      setQuestions((current) =>
        current.map((q, index) => (index === currentIndex ? { ...q, markedForReview: !next } : q)),
      );
    }
  };

  // Keyboard navigation for students who cannot comfortably use a mouse.
  React.useEffect(() => {
    if (phase !== 'active') return;

    const handler = (event: KeyboardEvent) => {
      // Written answers own the arrow keys while the caret is inside them.
      // Option cards are native radio / checkbox inputs underneath (React
      // Aria), and hold focus after a click, so they must not swallow Alt+←/→.
      const target = event.target;
      if (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox')
      ) {
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        goToQuestion(Math.min(questions.length - 1, currentIndex + 1));
      } else if (event.altKey && event.key === 'ArrowLeft') {
        // Going back is only allowed when navigation is not locked.
        if (!security?.lockQuestionNavigation) {
          event.preventDefault();
          goToQuestion(Math.max(0, currentIndex - 1));
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, questions.length, currentIndex, goToQuestion, security?.lockQuestionNavigation]);

  // Timers hold references to in-flight answers; clear them if the exam
  // unmounts so nothing fires against a torn-down component.
  React.useEffect(() => {
    const timers = debounceTimers.current;
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const answered = questions.filter(isAnswered).length;
  const flagged = questions.filter((q) => q.markedForReview).length;
  const currentQuestion = questions[currentIndex];

  // ------------------------------------------------------------------------
  if (phase === 'loading') return <ExamLoading />;
  if (phase === 'blocked' && blockedError) {
    return <ExamBlocked error={blockedError} attemptId={attemptId} />;
  }
  if (phase === 'submitted' && submitResult) {
    return <ExamSubmitted result={submitResult} />;
  }
  if (!state || !currentQuestion) return <ExamLoading />;

  const fullscreenRequired = state.quiz.security.requireFullscreen;
  const needsFullscreen = fullscreenRequired && !examSecurity.fullscreenActive;

  return (
    <div
      className={cn(
        'exam-shell flex min-h-dvh flex-col bg-background',
        state.quiz.security.blockCopyPaste && 'exam-no-select',
      )}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Logo size="sm" withWordmark={false} />
          <div className="min-w-0 flex-1 border-l border-border pl-3 sm:pl-4">
            <p className="truncate text-base font-semibold leading-tight">
              {state.quiz.title}
            </p>
            <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">
              Question {currentIndex + 1} of {questions.length} · {answered} answered
            </p>
          </div>

          <SecurityIndicator
            counters={examSecurity.counters}
            fullscreenActive={examSecurity.fullscreenActive}
            fullscreenRequired={fullscreenRequired}
            online={online && !connectionLost}
            deviceVerified
            cameraActive={state.quiz.security.cameraMonitoring ? cameraActive : null}
            microphoneActive={state.quiz.security.microphoneMonitoring ? microphoneActive : null}
            screenShareActive={state.quiz.security.requireScreenShare ? screenShareActive : null}
            singleDisplayActive={state.quiz.security.blockMultipleDisplays ? !multipleDisplaysDetected : null}
          />

          <ExamTimerDisplay
            remainingSeconds={timer.remainingSeconds}
            warning={timer.warning}
            critical={timer.critical}
          />
        </div>
      </header>

      {/* Nothing on the exam surface animates in or out — banners and gates
          appear at once, so a gate never leaves the paper half-visible. */}
      {/* Spoken once per extension. Always mounted so the region exists before
          its text changes; polite, so it never interrupts the minute
          announcements or the student's typing. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {extension?.message ?? ''}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {notices.length > 0 ? `Message from your faculty: ${notices[notices.length - 1]!.message}` : ''}
      </p>

      {connectionLost || (extension && !extension.dismissed) || notices.length > 0 ? (
        <div className="sticky top-16 z-20">
          {connectionLost ? (
            <div className="border-b border-warning/30 bg-warning-subtle" role="status">
              <div className="mx-auto flex max-w-[1440px] items-center gap-2.5 px-4 py-2.5 text-sm text-warning sm:px-6">
                <WifiOff className="size-4 shrink-0" aria-hidden />
                <p>
                  {unsentCount > 0
                    ? `Connection interrupted. ${unsentCount} answer${unsentCount === 1 ? ' is' : 's are'} waiting to be sent. ${unsentCount === 1 ? 'It is' : 'They are'} kept on this device and sent as soon as you are back online.`
                    : 'Connection interrupted. Your answers are kept on this device and sent as soon as you are back online.'}
                </p>
                <Loader2 className="ml-auto size-4 shrink-0 animate-spin" aria-hidden />
              </div>
            </div>
          ) : null}

          {/* Faculty notices: neutral and static, dismissible, never modal. */}
          {notices.map((notice) => (
            <div key={notice.id} className="border-b border-border bg-muted">
              <div className="mx-auto flex max-w-[1440px] items-start gap-2.5 px-4 py-2 text-sm text-foreground sm:px-6">
                <Megaphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="min-w-0 break-words">
                  <span className="font-medium">From your faculty: </span>
                  {notice.message}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto shrink-0 transition-none"
                  onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}

          {/* Neutral and static: it informs, it does not alarm. */}
          {extension && !extension.dismissed ? (
            <div className="border-b border-border bg-muted">
              <div className="mx-auto flex max-w-[1440px] items-center gap-2.5 px-4 py-1.5 text-sm text-foreground sm:px-6">
                <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <p>{extension.message}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto shrink-0 transition-none"
                  onClick={() => setExtension({ ...extension, dismissed: true })}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <main
        id="main"
        className="mx-auto grid w-full max-w-[1440px] flex-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[288px_minmax(0,1fr)] lg:gap-6 lg:py-6"
      >
        {/* Sidebar: navigator (scrolls internally) + submit, camera below.
            The whole column is sticky and capped to the viewport on desktop
            so neither part is ever pushed off screen. */}
        <aside className="order-2 flex flex-col gap-3 lg:sticky lg:top-[5.5rem] lg:order-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start">
          <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-4">
              <QuestionNavigator
                questions={questions.map((q) => ({
                  attemptQuestionId: q.attemptQuestionId,
                  position: q.position,
                  answered: isAnswered(q),
                  markedForReview: q.markedForReview,
                }))}
                currentIndex={currentIndex}
                onSelect={goToQuestion}
                lockNavigation={state.quiz.security.lockQuestionNavigation}
                highestVisited={highestVisited}
              />
            </div>

            {/* Submit — always visible at the bottom of the card */}
            <div className="shrink-0 border-t border-border p-3">
              <Button className="w-full" variant="outline" size="lg" onClick={() => setSubmitOpen(true)}>
                Submit exam
              </Button>
            </div>
          </div>

          {state.quiz.security.cameraMonitoring ||
          state.quiz.security.microphoneMonitoring ||
          state.quiz.security.requireScreenShare ? (
            <div className="shrink-0">
              <CameraMonitor
                enabled={state.quiz.security.cameraMonitoring}
                microphoneEnabled={state.quiz.security.microphoneMonitoring}
                screenShareEnabled={state.quiz.security.requireScreenShare}
                screenShareActive={screenShareActive === true}
                screenShareStream={screenShareStream}
                onEvent={examSecurity.record}
                onStatusChange={setCameraActive}
                onMicrophoneStatusChange={setMicrophoneActive}
                onRequestScreenShare={requestScreenShare}
              />
            </div>
          ) : null}
        </aside>

        <div className="order-1 min-h-[60dvh] lg:order-2">
          <QuestionPanel
            question={currentQuestion}
            index={currentIndex}
            total={questions.length}
            saving={savingIds.has(currentQuestion.attemptQuestionId)}
            savedAt={savedAtById[currentQuestion.attemptQuestionId]}
            unsaved={pendingSaves.current.has(currentQuestion.attemptQuestionId)}
            uploading={uploadingId === currentQuestion.attemptQuestionId}
            onAnswerChange={handleAnswerChange}
            onUploadAttachment={(file) => void uploadAttachment(file)}
            onRemoveAttachment={(id) => void removeAttachment(id)}
            onPickerOpen={() => examSecurity.setFilePickerOpen(true)}
            onToggleReview={() => void toggleReview()}
            onPrevious={
              state.quiz.security.lockQuestionNavigation
                ? undefined
                : () => goToQuestion(Math.max(0, currentIndex - 1))
            }
            onNext={() => goToQuestion(Math.min(questions.length - 1, currentIndex + 1))}
            onOpenSubmit={() => {
              flushPendingText();
              setSubmitOpen(true);
            }}
          />
        </div>
      </main>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answered={answered}
        total={questions.length}
        flagged={flagged}
        submitting={phase === 'submitting'}
        onConfirm={() => void submit(false)}
      />

      {/* Auto-submit at the buzzer. Static text, no spinner: the exam surface
          does not animate. The status line updates as retries happen. */}
      {phase === 'submitting' && autoSubmitFailures !== null ? (
        <ExamGate
          titleId="auto-submit-title"
          descriptionId="auto-submit-desc"
          tone="primary"
          icon={TimerOff}
          title="Time is up"
          description="Submitting your answers… Please keep this window open."
        >
          <p role="status" className="tabular mt-3 text-xs text-muted-foreground">
            {autoSubmitFailures === 0
              ? 'Sending your answers to the server.'
              : `Could not reach the server yet. Retrying automatically (attempt ${
                  autoSubmitFailures + 1
                }).`}
          </p>
        </ExamGate>
      ) : null}

      {/* Pause gate. Faculty stopped this attempt's clock; it clears by itself
          at the next heartbeat after they resume. */}
      {paused && phase === 'active' ? (
        <ExamGate
          titleId="paused-title"
          tone="primary"
          icon={Pause}
          title="Your exam is paused"
          description="Your faculty has paused your exam. Your timer is stopped and your answers are saved. This screen clears by itself when they resume."
        >
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            You do not need to do anything. Please stay on this page.
          </p>
        </ExamGate>
      ) : null}

      {/* Fullscreen gate. Rendered above everything so the paper is not
          readable while the requirement is unmet. */}
      {needsFullscreen && phase === 'active' ? (
        <ExamGate
          titleId="fullscreen-title"
          tone="warning"
          icon={Expand}
          title="Return to fullscreen"
          description="This examination must be taken in fullscreen. Your timer is still running and your answers are saved."
        >
          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => void examSecurity.enterFullscreen()}
          >
            <Expand aria-hidden />
            Resume in fullscreen
          </Button>
          <p className="tabular mt-3 text-xs text-muted-foreground">
            {examSecurity.counters.fullscreenExits > 0
              ? `${examSecurity.counters.fullscreenExits} fullscreen exit${
                  examSecurity.counters.fullscreenExits === 1 ? '' : 's'
                } recorded`
              : 'This event has been recorded for your faculty.'}
          </p>
        </ExamGate>
      ) : null}

      {/* Focus-loss gate. Shown when the student Alt+Tabs or clicks another
          app — the paper is replaced by an opaque screen so question content
          cannot be read from a recording or a photo of a second screen.
          Only rendered when tab-switch detection is enabled. */}
      {focusLost && phase === 'active' && state.quiz.security.detectTabSwitch ? (
        <ExamGate
          titleId="focus-lost-title"
          descriptionId="focus-lost-desc"
          tone="warning"
          icon={EyeOff}
          title="You left the exam window"
          description="Return to this window to continue your exam. Your time is still running, and your answers are saved."
        >
          <Button
            size="lg"
            className="mt-6 w-full"
            onClick={() => {
              window.focus();
              setFocusLost(false);
            }}
          >
            Return to exam
          </Button>
          <p className="tabular mt-3 text-xs text-muted-foreground">
            {examSecurity.counters.tabSwitches > 0
              ? `${examSecurity.counters.tabSwitches} window switch${
                  examSecurity.counters.tabSwitches === 1 ? '' : 'es'
                } recorded`
              : 'This event has been recorded for your faculty.'}
          </p>
        </ExamGate>
      ) : null}

      {/* Screen-share gate. Shown when entire screen sharing is required by faculty but not currently active. */}
      {state.quiz.security.requireScreenShare && screenShareActive !== true && phase === 'active' ? (
        <ExamGate
          titleId="screen-share-title"
          tone={screenShareStoppedCount > 0 ? 'danger' : 'primary'}
          icon={ScreenShare}
          title={screenShareStoppedCount > 0 ? 'Screen sharing stopped — Exam paused' : 'Screen sharing required'}
          description={
            screenShareStoppedCount > 0
              ? 'Your screen is no longer being shared. Continuous entire-screen proctoring is mandatory. The paper is locked until you share your screen again.'
              : 'This examination requires continuous entire-screen proctoring. You must grant permission to share your entire display to view the questions.'
          }
        >
          <Button size="lg" className="mt-6 w-full" onClick={() => void requestScreenShare()}>
            <ScreenShare aria-hidden />
            {screenShareStoppedCount > 0 ? 'Resume sharing entire screen' : 'Share entire screen'}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Ensure you choose <strong>Entire Screen</strong> when prompted. Window or tab shares are not accepted.
          </p>
          {screenShareStoppedCount > 0 ? (
            <p className="tabular mt-2 text-xs font-medium text-danger">
              {screenShareStoppedCount} screen share interruption{screenShareStoppedCount === 1 ? '' : 's'} recorded
            </p>
          ) : null}
        </ExamGate>
      ) : null}

      {/* Multiple-displays gate. Shown when secondary monitors or display extensions are detected. */}
      {state.quiz.security.blockMultipleDisplays && multipleDisplaysDetected && phase === 'active' ? (
        <ExamGate
          titleId="multi-display-title"
          tone="danger"
          icon={MonitorX}
          title="Multiple displays detected"
          description="Exam security policy prohibits secondary monitors or external screens. Please disconnect secondary monitors or disable display extension to resume."
        >
          <Button
            size="lg"
            variant="outline"
            className="mt-6 w-full"
            onClick={() => {
              const isExtended = Boolean(
                (window.screen as unknown as { isExtended?: boolean }).isExtended ||
                (window.screen.availWidth > window.screen.width * 1.5)
              );
              setMultipleDisplaysDetected(isExtended);
              if (!isExtended) {
                toast.success('Single display verified. Resuming exam.');
              } else {
                toast.error('Secondary display still detected. Please unplug or disable display projection.');
              }
            }}
          >
            Re-check displays
          </Button>
        </ExamGate>
      ) : null}
    </div>
  );
}

const GATE_TONES = {
  primary: 'bg-accent text-primary',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
} as const;

/**
 * A blocking screen over the paper. Fully opaque, so no question text shows
 * through; it appears instantly rather than fading in.
 */
function ExamGate({
  titleId,
  descriptionId,
  tone,
  icon: Icon,
  title,
  description,
  children,
}: {
  titleId: string;
  descriptionId?: string;
  tone: keyof typeof GATE_TONES;
  icon: typeof Expand;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 p-6"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-7 text-center shadow-overlay">
        <span
          className={cn(
            'mx-auto flex size-12 items-center justify-center rounded-full',
            GATE_TONES[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <h2 id={titleId} className="mt-4 text-xl">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}

function ExamLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
          <Skeleton className="size-7 rounded-lg" />
          <div className="flex-1 space-y-1.5 border-l border-border pl-3 sm:pl-4">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-[1440px] flex-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[288px_minmax(0,1fr)] lg:gap-6 lg:py-6">
        <Skeleton className="hidden h-[420px] rounded-lg lg:block" />
        <Skeleton className="h-[420px] rounded-lg" />
      </div>
      <p className="flex items-center justify-center gap-2 pb-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Preparing your examination…
      </p>
    </div>
  );
}

function ExamBlocked({ error, attemptId }: { error: ApiClientError; attemptId: string }) {
  const title =
    error.code === 'DEVICE_MISMATCH'
      ? 'Different device detected'
      : error.code === 'CONFLICT'
        ? 'Exam open in another session'
        : error.code === 'FORBIDDEN'
          ? 'You cannot access this attempt'
          : error.code === 'QUIZ_UNAVAILABLE'
            ? 'Exam unavailable'
            : 'Examination interrupted';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-7 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error.message}</p>

        <div className="mt-6 flex flex-col gap-2">
          <Button size="lg" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard">
              <LogOut aria-hidden />
              Back to dashboard
            </Link>
          </Button>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Attempt reference{' '}
          <span className="font-mono text-foreground">{attemptId.slice(0, 12)}</span>. Quote this to
          your invigilator if you need help.
        </p>
      </div>
    </div>
  );
}

function ExamSubmitted({ result }: { result: SubmitResult }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-7 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-subtle text-success">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl">Exam submitted successfully</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {result.autoSubmitted
            ? 'Your time expired and the paper was submitted automatically.'
            : 'Your answers have been recorded. You may now close this window.'}
        </p>

        <dl className="mt-6 divide-y divide-border rounded-md border border-border text-left text-sm">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">Submission time</dt>
            <dd className="font-medium">{formatDateTime(result.submittedAt)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">Questions answered</dt>
            <dd className="tabular font-medium">
              {result.answered} / {result.total}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted-foreground">Attempt ID</dt>
            <dd className="truncate font-mono text-xs">{result.attemptId}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-col gap-2">
          {result.resultsReleased ? (
            <Button asChild size="lg">
              <Link href={`/results/${result.attemptId}`}>View result</Link>
            </Button>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              {result.releasesAt
                ? `Results will be available after the quiz closes on ${formatDateTime(result.releasesAt)}.`
                : 'Results will be available once your faculty releases them for this quiz.'}
            </p>
          )}
          <Button asChild size="lg" variant={result.resultsReleased ? 'outline' : 'default'}>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
