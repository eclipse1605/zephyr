import type { ClosureAnswer, IncidentStatus } from "./types.js";

export const CLOSURE_WINDOW_MS = 72 * 60 * 60 * 1000;

export type ClosureState = {
  open: boolean;
  expiresAt: string | null;
  answer: ClosureAnswer | null;
};

export function openClosureWindow(resolvedAt: Date = new Date()): ClosureState {
  return {
    open: true,
    expiresAt: new Date(resolvedAt.getTime() + CLOSURE_WINDOW_MS).toISOString(),
    answer: null,
  };
}

export type ClosureApplyResult =
  | { ok: true; incidentStatus: IncidentStatus; event: "fix_confirmed" | "disputed"; closure: ClosureState }
  | { ok: false; error: "window_closed" | "token_mismatch" | "already_answered" };

export function applyClosureAnswer(args: {
  closure: ClosureState;
  answer: ClosureAnswer;
  tokenValid: boolean;
  now?: Date;
}): ClosureApplyResult {
  if (!args.tokenValid) return { ok: false, error: "token_mismatch" };
  if (args.closure.answer != null) return { ok: false, error: "already_answered" };
  if (!args.closure.open || !args.closure.expiresAt) return { ok: false, error: "window_closed" };
  const now = args.now ?? new Date();
  if (now.getTime() > Date.parse(args.closure.expiresAt)) {
    return { ok: false, error: "window_closed" };
  }

  if (args.answer === "FIXED") {
    return {
      ok: true,
      incidentStatus: "resolved",
      event: "fix_confirmed",
      closure: { ...args.closure, open: false, answer: "FIXED" },
    };
  }
  return {
    ok: true,
    incidentStatus: "disputed",
    event: "disputed",
    closure: { ...args.closure, open: false, answer: "STILL" },
  };
}
