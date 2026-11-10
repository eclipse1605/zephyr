const PER_KEY_LIMIT = 60;

type KeyBudget = { slots: number[]; coolUntil: number };

const budgets = new Map<string, KeyBudget>();
let openAqLast429: string | null = null;
let rotate = 0;

function budgetFor(key: string): KeyBudget {
  let row = budgets.get(key);
  if (!row) {
    row = { slots: [], coolUntil: 0 };
    budgets.set(key, row);
  }
  return row;
}

function prune(row: KeyBudget, now: number) {
  const cutoff = now - 60_000;
  row.slots = row.slots.filter((at) => at > cutoff);
}

export function resetOpenAqBudget() {
  budgets.clear();
  openAqLast429 = null;
  rotate = 0;
}

/** @deprecated Prefer takeOpenAqKey — kept for single-key callers/tests. */
export function takeOpenAqSlot(now = Date.now(), limit = PER_KEY_LIMIT): boolean {
  const key = "__default__";
  const row = budgetFor(key);
  prune(row, now);
  if (row.slots.length >= limit) return false;
  row.slots.push(now);
  return true;
}

/**
 * Pick a key with remaining rolling-minute quota (round-robin among ready keys).
 * Each key gets its own 60 req/min budget. Keys in 429 cooldown are skipped.
 */
export function takeOpenAqKey(keys: string[], now = Date.now(), perKeyLimit = PER_KEY_LIMIT): string | null {
  if (keys.length === 0) return null;
  const ready: string[] = [];
  for (const key of keys) {
    const row = budgetFor(key);
    prune(row, now);
    if (row.coolUntil > now) continue;
    if (row.slots.length < perKeyLimit) ready.push(key);
  }
  if (ready.length === 0) return null;
  const pick = ready[rotate % ready.length]!;
  rotate += 1;
  budgetFor(pick).slots.push(now);
  return pick;
}

/** Milliseconds until any key in the pool has a free slot (or null if never). */
export function msUntilOpenAqKey(keys: string[], now = Date.now(), perKeyLimit = PER_KEY_LIMIT): number | null {
  if (keys.length === 0) return null;
  let soonest: number | null = null;
  for (const key of keys) {
    const row = budgetFor(key);
    prune(row, now);
    if (row.coolUntil <= now && row.slots.length < perKeyLimit) return 0;
    const waits: number[] = [];
    if (row.coolUntil > now) waits.push(row.coolUntil - now);
    if (row.slots.length >= perKeyLimit) {
      const oldest = Math.min(...row.slots);
      waits.push(Math.max(1, oldest + 60_000 - now));
    }
    const wait = waits.length ? Math.max(...waits) : 0;
    if (soonest == null || wait < soonest) soonest = wait;
  }
  return soonest;
}

export type TakeOpenAqKeyWaitOpts = {
  /** Wall clock, or a mutable `{ now }` box for tests. */
  clock?: { now: number };
  maxWaitMs?: number;
  perKeyLimit?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reserve a key, waiting for rolling-minute quota or 429 cooldown to clear.
 * Throws `OpenAQ budget` if still exhausted after maxWaitMs (default 90s).
 */
export async function takeOpenAqKeyOrWait(keys: string[], opts: TakeOpenAqKeyWaitOpts = {}): Promise<string> {
  if (keys.length === 0) throw new Error("OPENAQ_API_KEY not configured");
  const maxWaitMs = opts.maxWaitMs ?? 90_000;
  const perKeyLimit = opts.perKeyLimit ?? PER_KEY_LIMIT;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = opts.clock;
  const readNow = () => clock?.now ?? Date.now();
  const started = readNow();

  while (true) {
    const now = readNow();
    const key = takeOpenAqKey(keys, now, perKeyLimit);
    if (key) return key;
    const wait = msUntilOpenAqKey(keys, now, perKeyLimit);
    if (wait == null) throw new Error("OpenAQ budget");
    const elapsed = now - started;
    const step = Math.max(1, Math.min(wait, 1_000, maxWaitMs - elapsed));
    if (elapsed + step > maxWaitMs) throw new Error("OpenAQ budget");
    await sleep(step);
    if (clock) clock.now += step;
  }
}

/** @deprecated Prefer takeOpenAqKey. */
export function openAqRequestKey(keys: string[]): string | null {
  return takeOpenAqKey(keys);
}

export function openAqBudgetStatus(now = Date.now(), keyCount = 1) {
  const cutoff = now - 60_000;
  let used = 0;
  let cooling = 0;
  for (const row of budgets.values()) {
    used += row.slots.filter((at) => at > cutoff).length;
    if (row.coolUntil > now) cooling += 1;
  }
  const keys = Math.max(1, keyCount);
  return {
    used,
    limit: PER_KEY_LIMIT * keys,
    keys,
    cooling,
    last429: openAqLast429,
  };
}

export function noteOpenAq429(opts?: { key?: string; retryAfterSec?: number; at?: number }) {
  const at = opts?.at ?? Date.now();
  openAqLast429 = new Date(at).toISOString();
  const key = opts?.key;
  if (!key) return;
  const row = budgetFor(key);
  const waitMs = opts?.retryAfterSec != null && Number.isFinite(opts.retryAfterSec)
    ? Math.max(1, opts.retryAfterSec) * 1000
    : 60_000;
  row.coolUntil = Math.max(row.coolUntil, at + waitMs);
}
