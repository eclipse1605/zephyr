export type WorkOrderPriority = "immediate" | "within_24h" | "routine";

export const SLA_HOURS: Record<WorkOrderPriority, number> = {
  immediate: 4,
  within_24h: 24,
  routine: 72,
};

export function isOverdue(args: {
  openedAt: string;
  priority: WorkOrderPriority;
  now?: Date;
}): boolean {
  const opened = Date.parse(args.openedAt);
  if (!Number.isFinite(opened)) return false;
  const now = args.now ?? new Date();
  return now.getTime() - opened > SLA_HOURS[args.priority] * 3600_000;
}
