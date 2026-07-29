import { bench, describe } from "vitest";
import { inactivityDeadline, isInactive, retryDelayMinutes } from "../src/core/policy";
import { validateSettings } from "../src/core/validation";
import { createDefaultSettings } from "../src/core/defaults";

const settings = createDefaultSettings();

describe("policy hot paths", () => {
  bench("evaluate inactivity", () => {
    isInactive(1_800_001, 1, settings.reusablePolicy);
    inactivityDeadline(1, settings.reusablePolicy);
  });

  bench("select bounded retry", () => {
    retryDelayMinutes(settings.retry.delaysMinutes, 3);
  });

  bench("validate imported settings", () => {
    validateSettings(settings);
  });
});
