import type { ExamEventType, IntegrityStatus } from '@prisma/client';

// Relative rather than aliased: this module is imported directly by the Prisma
// seed script, which runs outside the Next.js module resolver.
import { EVENT_LABELS_CLIENT } from './event-labels';

/**
 * The Integrity Engine.
 *
 * It produces a *risk indicator for human review*, never a verdict. Every
 * signal it consumes has an innocent explanation â€” a notification stealing
 * focus, flaky campus Wi-Fi, a laptop lid closing â€” so penalties are
 * deliberately gentle for the first occurrence and grow with repetition.
 */

interface SignalRule {
  /** Points deducted for the first occurrence. */
  base: number;
  /** Points deducted for each subsequent occurrence. */
  repeat: number;
  /** Never deduct more than this in total for one signal. */
  cap: number;
  label: string;
  /** Occurrences at or below this count are treated as noise and not penalised. */
  tolerance?: number;
}

const SIGNALS: Partial<Record<ExamEventType, SignalRule>> = {
  TAB_SWITCH: { base: 8, repeat: 6, cap: 32, label: 'Tab switch' },
  WINDOW_BLUR: { base: 3, repeat: 2, cap: 14, label: 'Window lost focus', tolerance: 1 },
  FULLSCREEN_EXIT: { base: 6, repeat: 5, cap: 26, label: 'Fullscreen exited' },
  COPY_ATTEMPT: { base: 7, repeat: 5, cap: 24, label: 'Copy attempt' },
  PASTE_ATTEMPT: { base: 10, repeat: 7, cap: 30, label: 'Paste attempt' },
  CUT_ATTEMPT: { base: 7, repeat: 5, cap: 22, label: 'Cut attempt' },
  CONTEXT_MENU: { base: 2, repeat: 1, cap: 8, label: 'Context menu', tolerance: 1 },
  PRINT_ATTEMPT: { base: 12, repeat: 8, cap: 30, label: 'Print attempt' },
  SHORTCUT_BLOCKED: { base: 4, repeat: 3, cap: 18, label: 'Blocked shortcut' },
  NETWORK_OFFLINE: { base: 2, repeat: 2, cap: 10, label: 'Network disconnected', tolerance: 1 },
  MULTIPLE_SESSION: { base: 20, repeat: 12, cap: 40, label: 'Second active session' },
  DEVICE_MISMATCH: { base: 18, repeat: 10, cap: 36, label: 'Device changed mid-exam' },
  CAMERA_PERMISSION_LOST: { base: 10, repeat: 6, cap: 26, label: 'Camera permission lost' },
  CAMERA_STREAM_STOPPED: { base: 8, repeat: 5, cap: 22, label: 'Camera stream stopped' },
  FACE_NOT_DETECTED: { base: 4, repeat: 3, cap: 20, label: 'Face not detected', tolerance: 2 },
  MULTIPLE_FACES: { base: 14, repeat: 9, cap: 34, label: 'Multiple faces detected' },
  MICROPHONE_LOST: { base: 6, repeat: 4, cap: 18, label: 'Microphone lost' },
  RESIZE_SUSPICIOUS: { base: 3, repeat: 2, cap: 10, label: 'Unusual window resize', tolerance: 1 },
  HEARTBEAT_MISSED: { base: 3, repeat: 3, cap: 15, label: 'Heartbeat missed', tolerance: 1 },
  IDLE_TIMEOUT: { base: 2, repeat: 2, cap: 8, label: 'Extended inactivity', tolerance: 1 },
  MULTIPLE_DISPLAYS_DETECTED: { base: 14, repeat: 9, cap: 32, label: 'Secondary display detected' },
  SCREEN_SHARE_STOPPED: { base: 12, repeat: 8, cap: 30, label: 'Screen share stopped' },
  SCREEN_SHARE_PERMISSION_LOST: { base: 10, repeat: 6, cap: 24, label: 'Screen share permission lost' },
};

/** Informational events that are recorded for the timeline but never scored. */
const NEUTRAL_EVENTS: ExamEventType[] = [
  'ATTEMPT_STARTED',
  'ATTEMPT_SUBMITTED',
  'AUTO_SUBMITTED',
  'ANSWER_SAVED',
  'WINDOW_FOCUS',
  'FULLSCREEN_ENTER',
  'NETWORK_ONLINE',
  'ATTACHMENT_UPLOADED',
  'ANSWER_GRADED',
];

/**
 * A native file picker blurs the window without hiding the document, so a
 * question that asks for a photograph of working would otherwise cost the
 * student integrity points for doing exactly what was asked.
 *
 * The event is still recorded and still shown on the timeline — faculty see
 * that focus was lost and why. It is simply not scored against them. The
 * trade-off is disclosed rather than hidden: blur during an open picker is not
 * counted, which is a narrow, deliberate blind spot.
 */
function isFilePickerBlur(event: { type: ExamEventType; metadata?: unknown }): boolean {
  // A native file dialog also drops fullscreen, so that exit is annotated alike.
  if (event.type !== 'WINDOW_BLUR' && event.type !== 'FULLSCREEN_EXIT') return false;
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).context === 'file-picker';
}

export const INTEGRITY_THRESHOLDS = {
  normal: 85, // >= 85
  review: 60, // 60..84
} as const;

export interface SignalBreakdown {
  type: ExamEventType;
  label: string;
  count: number;
  penalty: number;
  totalDurationMs: number;
}

export interface IntegrityComputation {
  score: number;
  status: IntegrityStatus;
  breakdown: SignalBreakdown[];
  /** Positive statements for the report ("no paste attempts"). */
  clean: string[];
  eventCount: number;
}

export function statusForScore(score: number): IntegrityStatus {
  if (score >= INTEGRITY_THRESHOLDS.normal) return 'NORMAL';
  if (score >= INTEGRITY_THRESHOLDS.review) return 'REVIEW_RECOMMENDED';
  return 'HIGH_RISK';
}

export const INTEGRITY_STATUS_LABEL: Record<IntegrityStatus, string> = {
  NORMAL: 'Normal',
  REVIEW_RECOMMENDED: 'Review recommended',
  HIGH_RISK: 'High risk',
};

/** Signals a clean attempt is affirmatively reported as *not* having. */
const HEADLINE_CLEAN_SIGNALS: ExamEventType[] = [
  'MULTIPLE_SESSION',
  'COPY_ATTEMPT',
  'PASTE_ATTEMPT',
  'TAB_SWITCH',
  'FULLSCREEN_EXIT',
];

export function computeIntegrity(
  events: Array<{ type: ExamEventType; durationMs?: number | null; metadata?: unknown }>,
  /**
   * How many file-picker-tagged events may be ignored. The tag is written by
   * the student's browser, so the server caps it by what the attempt can
   * evidence (see `filePickerAllowance`); events beyond it are scored as usual.
   */
  filePickerAllowance = Infinity,
): IntegrityComputation {
  const grouped = new Map<ExamEventType, { count: number; duration: number }>();
  let exemptLeft = filePickerAllowance;

  for (const event of events) {
    if (NEUTRAL_EVENTS.includes(event.type)) continue;
    if (isFilePickerBlur(event) && exemptLeft > 0) {
      exemptLeft -= 1;
      continue;
    }
    const entry = grouped.get(event.type) ?? { count: 0, duration: 0 };
    entry.count += 1;
    entry.duration += event.durationMs ?? 0;
    grouped.set(event.type, entry);
  }

  const breakdown: SignalBreakdown[] = [];
  let deduction = 0;

  for (const [type, entry] of grouped) {
    const rule = SIGNALS[type];
    if (!rule) continue;

    const tolerance = rule.tolerance ?? 0;
    const scored = Math.max(0, entry.count - tolerance);
    let penalty = 0;
    if (scored > 0) {
      penalty = Math.min(rule.cap, rule.base + (scored - 1) * rule.repeat);
    }

    deduction += penalty;
    breakdown.push({
      type,
      label: rule.label,
      count: entry.count,
      penalty,
      totalDurationMs: entry.duration,
    });
  }

  // Highest-impact signals first so the report leads with what matters.
  breakdown.sort(
    (a, b) => b.penalty - a.penalty || b.count - a.count || a.type.localeCompare(b.type),
  );

  const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));
  const clean = HEADLINE_CLEAN_SIGNALS.filter((type) => !grouped.has(type)).map(
    (type) => `No ${SIGNALS[type]!.label.toLowerCase()} recorded`,
  );

  return {
    score,
    status: statusForScore(score),
    breakdown,
    clean,
    eventCount: events.length,
  };
}

/** Severity assigned to an incoming event, used for timeline colour coding. */
export function severityForEvent(type: ExamEventType) {
  if (NEUTRAL_EVENTS.includes(type)) return 'INFO' as const;
  const rule = SIGNALS[type];
  if (!rule) return 'INFO' as const;
  if (rule.base >= 12) return 'HIGH' as const;
  if (rule.base >= 6) return 'MEDIUM' as const;
  return 'LOW' as const;
}

/** Re-exported with the Prisma enum applied, so a new event type cannot be
 *  added without also giving it a label. */
export const EVENT_LABELS = EVENT_LABELS_CLIENT as Record<ExamEventType, string>;
