/**
 * Folds the raw exam-event stream into incidents a person can read.
 *
 * One tab switch is recorded as several events (window blur, tab switch,
 * window focus ...). Faculty need the incident, not the plumbing, but every raw
 * event stays reachable: each input event belongs to exactly one incident and
 * nothing is dropped, merged away or reworded as an accusation.
 *
 * Pure and client-safe (no Prisma, no server-only), so the admin report and its
 * tests share it. Event types are plain strings for the same reason.
 *
 * Rules, all deterministic:
 *  - Related events fold only inside one family (left window, left full screen,
 *    connection lost, camera lost, screen share lost). Families are independent,
 *    so an unrelated event in the middle never breaks one.
 *  - Opening events must follow each other within INCIDENT_GAP_MS.
 *  - A closing event (focus, re-entering full screen, back online) attaches only
 *    when it is within INCIDENT_GAP_MS of the last opening event, or when its own
 *    reported durationMs reaches back to the first one. The second case exists
 *    because timestamps are the server's receipt time and the browser batches
 *    events (~8 s), so a 23 s absence arrives as two batches ~16 s apart.
 *  - Anything else is a single-event incident.
 */
import { EVENT_LABELS_CLIENT } from './event-labels';

/** Longest gap between members of one incident (see the rules above). */
export const INCIDENT_GAP_MS = 10_000;

export interface IncidentEvent {
  type: string;
  /** Server timestamp, ISO 8601. */
  occurredAt: string;
  durationMs?: number | null;
  metadata?: unknown;
  /** Server-supplied label; falls back to EVENT_LABELS_CLIENT. */
  label?: string;
}

export type FamilyKind =
  | 'left-window'
  | 'left-fullscreen'
  | 'connection-lost'
  | 'camera-lost'
  | 'screen-share-lost';

export type IncidentKind = FamilyKind | `event:${string}`;

export interface Incident<E extends IncidentEvent = IncidentEvent> {
  /** Unique within one groupIncidents() result and stable for the same input. */
  id: string;
  kind: IncidentKind;
  /** Plain-language, descriptive title. */
  title: string;
  /** Server time of the first and last member (ISO 8601). */
  startedAt: string;
  endedAt: string;
  /** Time away / offline when known (the closing event's own report, else the
   *  server-time span); null for open-ended or instantaneous incidents. */
  durationMs: number | null;
  /** Lifecycle markers (exam started / submitted, attachments, grading): context, not incidents. */
  routine: boolean;
  /**
   * Present only when a breakdown was supplied: true if any member is of a type
   * that carries a penalty in it. Tolerance is applied per type, not per
   * occurrence, so which single occurrence was tolerated is not knowable here.
   */
  scored?: boolean;
  /** Raw members in time order. */
  events: E[];
}

export interface BreakdownLike {
  type: string;
  penalty: number;
}

type Role = 'open' | 'join' | 'close';

interface Family {
  kind: FamilyKind;
  /** Fewer members than this and the group is not worth naming: stay single. */
  minSize: number;
  title: (closed: boolean, durationMs: number | null) => string;
}

const away: Family = {
  kind: 'left-window',
  minSize: 1,
  title: (closed, ms) =>
    closed && ms !== null
      ? `Left the exam window for ${formatSpan(ms)}`
      : closed
        ? 'Left the exam window and returned'
        : 'Left the exam window (no return recorded)',
};
const fullscreen: Family = {
  kind: 'left-fullscreen',
  minSize: 1,
  title: (closed, ms) =>
    closed && ms !== null
      ? `Left full screen for ${formatSpan(ms)}`
      : closed
        ? 'Left full screen and re-entered'
        : 'Left full screen (no re-entry recorded)',
};
const network: Family = {
  kind: 'connection-lost',
  minSize: 1,
  title: (closed, ms) =>
    closed && ms !== null
      ? `Connection lost for ${formatSpan(ms)}`
      : closed
        ? 'Connection lost and restored'
        : 'Connection lost (no reconnection recorded)',
};
const camera: Family = { kind: 'camera-lost', minSize: 2, title: () => 'Camera became unavailable' };
const screenShare: Family = {
  kind: 'screen-share-lost',
  minSize: 2,
  title: () => 'Screen sharing was interrupted',
};

const ROLES: Record<string, [Family, Role]> = {
  WINDOW_BLUR: [away, 'open'],
  TAB_SWITCH: [away, 'open'],
  WINDOW_FOCUS: [away, 'close'],
  FULLSCREEN_EXIT: [fullscreen, 'open'],
  FULLSCREEN_ENTER: [fullscreen, 'close'],
  NETWORK_OFFLINE: [network, 'open'],
  NETWORK_ONLINE: [network, 'close'],
  CAMERA_PERMISSION_LOST: [camera, 'open'],
  CAMERA_STREAM_STOPPED: [camera, 'open'],
  SCREEN_SHARE_STOPPED: [screenShare, 'open'],
  SCREEN_SHARE_PERMISSION_LOST: [screenShare, 'open'],
};

/** Mirrors the lifecycle subset of the engine's NEUTRAL_EVENTS. */
const ROUTINE_TYPES = new Set([
  'ATTEMPT_STARTED',
  'ATTEMPT_SUBMITTED',
  'AUTO_SUBMITTED',
  'ANSWER_SAVED',
  'ATTACHMENT_UPLOADED',
  'ANSWER_GRADED',
]);

function meta(event: IncidentEvent): Record<string, unknown> | null {
  const m = event.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

/** Alt+Tab is logged as TAB_SWITCH plus SHORTCUT_BLOCKED: the latter joins, never starts. */
function routeOf(event: IncidentEvent): [Family, Role] | undefined {
  if (event.type === 'SHORTCUT_BLOCKED') {
    return meta(event)?.shortcut === 'Alt+Tab' ? [away, 'join'] : undefined;
  }
  return ROLES[event.type];
}

/** "23 s", "1 min 5 s", "1 h 2 min". */
export function formatSpan(ms: number): string {
  if (ms < 1000) return 'under 1 s';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

interface Item<E extends IncidentEvent> {
  event: E;
  /** Position in the input, the last tie-breaker. */
  index: number;
  /** Position after sorting. */
  pos: number;
  t: number;
  clientT: number;
}

interface Cluster<E extends IncidentEvent> {
  members: Item<E>[];
  firstT: number;
  lastT: number;
}

export function groupIncidents<E extends IncidentEvent>(
  events: readonly E[],
  breakdown?: readonly BreakdownLike[],
): Incident<E>[] {
  // Server time orders events. Several events share one timestamp (a batch is
  // stamped on arrival and the database does not promise an order among ties),
  // so ties fall back to the client's own clock, which can only reorder events
  // the server could not tell apart, then to input order.
  const items: Item<E>[] = events
    .map((event, index) => ({
      event,
      index,
      pos: 0,
      t: Date.parse(event.occurredAt),
      clientT: Date.parse(String(meta(event)?.clientTs ?? '')),
    }))
    .sort((a, b) => a.t - b.t || a.clientT - b.clientT || a.index - b.index);
  items.forEach((item, pos) => (item.pos = pos));

  const penalty = new Map<string, number>();
  for (const row of breakdown ?? []) penalty.set(row.type, (penalty.get(row.type) ?? 0) + row.penalty);

  const built: Array<{ first: number; incident: Incident<E> }> = [];

  const emit = (members: Item<E>[], family: Family | null, closed: boolean) => {
    const first = members[0]!;
    const last = members[members.length - 1]!;
    const closer = closed ? last.event.durationMs : null;
    const span = last.t - first.t;
    const durationMs =
      family && closed
        ? typeof closer === 'number' && closer >= 0
          ? closer
          : Number.isFinite(span)
            ? span
            : null
        : family
          ? null
          : (first.event.durationMs ?? null);
    const type = first.event.type;
    const incident: Incident<E> = {
      id: `${family?.kind ?? `event:${type}`}#${first.pos}`,
      kind: family?.kind ?? `event:${type}`,
      title: family
        ? family.title(closed, durationMs)
        : (first.event.label ?? EVENT_LABELS_CLIENT[type] ?? type),
      startedAt: first.event.occurredAt,
      endedAt: last.event.occurredAt,
      durationMs,
      routine: !family && ROUTINE_TYPES.has(type),
      events: members.map((m) => m.event),
    };
    if (breakdown) {
      incident.scored = members.some(
        (m) => (penalty.get(m.event.type) ?? 0) > 0 && meta(m.event)?.context !== 'file-picker',
      );
    }
    built.push({ first: first.pos, incident });
  };

  const settle = (family: Family, cluster: Cluster<E>) => {
    if (cluster.members.length >= family.minSize) emit(cluster.members, family, false);
    else for (const member of cluster.members) emit([member], null, false);
  };

  const pending = new Map<Family, Cluster<E>>();

  for (const item of items) {
    const route = routeOf(item.event);
    if (!route) {
      emit([item], null, false);
      continue;
    }
    const [family, role] = route;
    let cluster = pending.get(family);

    if (role === 'open') {
      if (cluster && item.t - cluster.lastT > INCIDENT_GAP_MS) {
        settle(family, cluster);
        cluster = undefined;
      }
      if (!cluster) {
        cluster = { members: [], firstT: item.t, lastT: item.t };
        pending.set(family, cluster);
      }
      cluster.members.push(item);
      cluster.lastT = item.t;
    } else if (role === 'join') {
      if (cluster && item.t - cluster.lastT <= INCIDENT_GAP_MS) {
        cluster.members.push(item);
        cluster.lastT = item.t;
      } else {
        emit([item], null, false);
      }
    } else {
      const reported = item.event.durationMs;
      const attaches =
        cluster !== undefined &&
        (item.t - cluster.lastT <= INCIDENT_GAP_MS ||
          (typeof reported === 'number' &&
            reported >= 0 &&
            item.t - cluster.firstT <= reported + INCIDENT_GAP_MS));
      if (cluster && attaches) {
        cluster.members.push(item);
        pending.delete(family);
        emit(cluster.members, family, true);
      } else {
        emit([item], null, false);
      }
    }
  }

  for (const [family, cluster] of pending) settle(family, cluster);

  return built.sort((a, b) => a.first - b.first).map((b) => b.incident);
}
