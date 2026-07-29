import { describe, expect, it } from "vitest";
import {
  inactivityDeadline,
  isInactive,
  retryDelayMinutes,
} from "../../src/core/policy";
import type { LifecyclePolicy } from "../../src/core/types";

const policy: LifecyclePolicy = {
  destroyOnLastTabClose: true,
  destroyOnBrowserRestart: false,
  inactivity: { enabled: true, minutes: 30 },
};

describe("lifecycle policy", () => {
  it("computes deterministic inactivity deadlines", () => {
    expect(inactivityDeadline(1_000, policy)).toBe(1_801_000);
    expect(isInactive(1_800_999, 1_000, policy)).toBe(false);
    expect(isInactive(1_801_000, 1_000, policy)).toBe(true);
  });

  it("does not create deadlines when inactivity is disabled", () => {
    expect(
      inactivityDeadline(100, {
        ...policy,
        inactivity: { enabled: false, minutes: 1 },
      }),
    ).toBeUndefined();
  });

  it("bounds retries to the configured backoff table", () => {
    const delays = [1, 5, 30];
    expect(retryDelayMinutes(delays, 1)).toBe(1);
    expect(retryDelayMinutes(delays, 2)).toBe(5);
    expect(retryDelayMinutes(delays, 99)).toBe(30);
    expect(retryDelayMinutes([], 2)).toBe(1);
  });
});
