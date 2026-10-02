/*
 * Unsaved exam answers, kept in the browser until the server confirms them.
 *
 * Each draft carries a sequence number that only ever grows. The server keeps
 * the highest one it has seen per answer, so a slow, retried request can never
 * overwrite a newer edit; and an acknowledgement removes a draft only if it is
 * still the one that was sent, so an edit made while a request was in flight is
 * not thrown away.
 *
 * The storage is injected so this stays testable without a browser. Any storage
 * failure (private mode, quota) degrades to "no persistence", never to an error.
 */

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Draft<P> {
  seq: number;
  payload: P;
}

interface Stored<P> {
  last: number;
  items: Record<string, Draft<P>>;
}

const keyFor = (attemptId: string) => `sq-drafts:${attemptId}`;

function read<P>(kv: KV, attemptId: string): Stored<P> {
  try {
    const parsed = JSON.parse(kv.getItem(keyFor(attemptId)) ?? 'null') as Stored<P> | null;
    if (parsed && typeof parsed.last === 'number' && parsed.items && typeof parsed.items === 'object') {
      return parsed;
    }
  } catch {
    // fall through to an empty store
  }
  return { last: 0, items: {} };
}

function write<P>(kv: KV, attemptId: string, stored: Stored<P>) {
  try {
    kv.setItem(keyFor(attemptId), JSON.stringify(stored));
  } catch {
    // out of space or storage disabled: the in-memory queue still works
  }
}

/** The next sequence number: always above the last one, and roughly wall-clock so it survives a cleared store. */
export function nextSeq(last: number, now = Date.now()): number {
  return Math.max(last + 1, now);
}

/** Stores (replacing any earlier draft for the question) and returns its sequence number. */
export function saveDraft<P>(
  kv: KV | null,
  attemptId: string,
  attemptQuestionId: string,
  payload: P,
  now = Date.now(),
): number | undefined {
  if (!kv) return undefined;
  const stored = read<P>(kv, attemptId);
  const seq = nextSeq(stored.last, now);
  stored.last = seq;
  stored.items[attemptQuestionId] = { seq, payload };
  write(kv, attemptId, stored);
  return seq;
}

export function getDraft<P>(
  kv: KV | null,
  attemptId: string,
  attemptQuestionId: string,
): Draft<P> | undefined {
  return kv ? read<P>(kv, attemptId).items[attemptQuestionId] : undefined;
}

/** Every unsynced draft for an attempt, keyed by question. */
export function loadDrafts<P>(kv: KV | null, attemptId: string): Record<string, Draft<P>> {
  return kv ? read<P>(kv, attemptId).items : {};
}

/** Removes the draft only if it is still the acknowledged one. Returns whether it was removed. */
export function ackDraft(
  kv: KV | null,
  attemptId: string,
  attemptQuestionId: string,
  seq: number | undefined,
): boolean {
  if (!kv || seq === undefined) return false;
  const stored = read<unknown>(kv, attemptId);
  if (stored.items[attemptQuestionId]?.seq !== seq) return false;
  delete stored.items[attemptQuestionId];
  write(kv, attemptId, stored);
  return true;
}

export function clearDrafts(kv: KV | null, attemptId: string) {
  try {
    kv?.removeItem(keyFor(attemptId));
  } catch {
    // nothing to do
  }
}

/** Whether the server should apply a write carrying `incoming`, given the highest it has stored. */
export function shouldApply(stored: bigint | number | null | undefined, incoming: number | undefined) {
  if (incoming === undefined || stored === null || stored === undefined) return true;
  return BigInt(incoming) > BigInt(stored);
}
