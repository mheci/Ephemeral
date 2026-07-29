import { inactivityDeadline, retryDelayMinutes } from "../core/policy";
import type { ContainerRecord, Settings } from "../core/types";
import type { BrowserAdapter } from "./browser-adapter";

const INACTIVITY_PREFIX = "ephemeral:inactivity:";
const RETRY_PREFIX = "ephemeral:retry:";
const RECOVERY_ALARM = "ephemeral:recovery";
const MIN_ALARM_LEAD_MS = 1_000;

export type ParsedAlarm =
  | { kind: "inactivity"; containerId: string }
  | { kind: "retry"; containerId: string }
  | { kind: "recovery" }
  | { kind: "unknown" };

export class Scheduler {
  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  public async scheduleInactivity(record: ContainerRecord): Promise<void> {
    const deadline = inactivityDeadline(record.lastActivityAt, record.policy);
    const name = `${INACTIVITY_PREFIX}${record.id}`;
    if (deadline === undefined || record.status !== "active") {
      await this.adapter.cancelAlarm(name);
      return;
    }
    await this.adapter.scheduleAlarm(
      name,
      Math.max(deadline, this.now() + MIN_ALARM_LEAD_MS),
    );
  }

  public async cancelForContainer(containerId: string): Promise<void> {
    await Promise.all([
      this.adapter.cancelAlarm(`${INACTIVITY_PREFIX}${containerId}`),
      this.adapter.cancelAlarm(`${RETRY_PREFIX}${containerId}`),
    ]);
  }

  public async scheduleRetry(
    record: ContainerRecord,
    settings: Settings,
  ): Promise<void> {
    const delay = retryDelayMinutes(
      settings.retry.delaysMinutes,
      record.cleanupAttempts,
    );
    await this.adapter.scheduleAlarm(
      `${RETRY_PREFIX}${record.id}`,
      this.now() + delay * 60_000,
    );
  }

  public async armRecovery(): Promise<void> {
    await this.adapter.scheduleAlarm(RECOVERY_ALARM, this.now() + 60_000);
  }

  public async cancelRecovery(): Promise<void> {
    await this.adapter.cancelAlarm(RECOVERY_ALARM);
  }

  public parse(name: string): ParsedAlarm {
    if (name === RECOVERY_ALARM) return { kind: "recovery" };
    if (name.startsWith(INACTIVITY_PREFIX)) {
      return { kind: "inactivity", containerId: name.slice(INACTIVITY_PREFIX.length) };
    }
    if (name.startsWith(RETRY_PREFIX)) {
      return { kind: "retry", containerId: name.slice(RETRY_PREFIX.length) };
    }
    return { kind: "unknown" };
  }
}
