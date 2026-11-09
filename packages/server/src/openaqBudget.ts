let openAqSlots: number[] = [];
let openAqLast429: string | null = null;

export function resetOpenAqBudget() {
  openAqSlots = [];
  openAqLast429 = null;
}

/** One key, 60 requests per rolling minute. Extra keys are not used to multiply quota. */
export function takeOpenAqSlot(now = Date.now(), limit = 60): boolean {
  const cutoff = now - 60_000;
  openAqSlots = openAqSlots.filter((at) => at > cutoff);
  if (openAqSlots.length >= limit) return false;
  openAqSlots.push(now);
  return true;
}

export function openAqBudgetStatus(now = Date.now()) {
  const cutoff = now - 60_000;
  return {
    used: openAqSlots.filter((at) => at > cutoff).length,
    limit: 60,
    last429: openAqLast429,
  };
}

export function noteOpenAq429(at = new Date().toISOString()) {
  openAqLast429 = at;
}

export function openAqRequestKey(keys: string[]): string | null {
  return keys[0] ?? null;
}
