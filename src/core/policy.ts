import type { ContainerKind, LifecyclePolicy } from "./types";

const MINUTE_MS = 60_000;

export function inactivityDeadline(
  lastActivityAt: number,
  policy: LifecyclePolicy,
): number | undefined {
  if (!policy.inactivity.enabled) return undefined;
  return lastActivityAt + policy.inactivity.minutes * MINUTE_MS;
}

export function isInactive(
  now: number,
  lastActivityAt: number,
  policy: LifecyclePolicy,
): boolean {
  const deadline = inactivityDeadline(lastActivityAt, policy);
  return deadline !== undefined && now >= deadline;
}

export function policyForKind(
  kind: ContainerKind,
  oneTime: LifecyclePolicy,
  reusable: LifecyclePolicy,
): LifecyclePolicy {
  return structuredClone(kind === "one-time" ? oneTime : reusable);
}

export function retryDelayMinutes(delays: readonly number[], attempt: number): number {
  if (delays.length === 0) return 1;
  const index = Math.max(0, Math.min(attempt - 1, delays.length - 1));
  return delays[index] ?? 1;
}
