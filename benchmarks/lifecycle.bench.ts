import { test } from "vitest";
import { inactivityDeadline, isInactive, retryDelayMinutes } from "../src/core/policy";
import { validateSettings } from "../src/core/validation";
import { createDefaultSettings } from "../src/core/defaults";

const settings = createDefaultSettings();

test("policy hot paths", async ({ bench }) => {
  await bench("evaluate inactivity", () => {
    isInactive(1_800_001, 1, settings.reusablePolicy);
    inactivityDeadline(1, settings.reusablePolicy);
  }).run();

  await bench("select bounded retry", () => {
    retryDelayMinutes(settings.retry.delaysMinutes, 3);
  }).run();

  await bench("validate imported settings", () => {
    validateSettings(settings);
  }).run();
});
