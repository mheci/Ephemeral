import { createDefaultSettings } from "./defaults";
import type { LifecyclePolicy, Settings, SettingsExport } from "./types";
import { SETTINGS_EXPORT_VERSION, STATE_SCHEMA_VERSION } from "./types";

const MAX_IMPORT_BYTES = 65_536;
const MAX_INACTIVITY_MINUTES = 10_080;
const MAX_GRACE_SECONDS = 600;
const SAFE_NAME = /^[^\p{Cc}\p{Cf}]{1,30}$/u;
const SAFE_STYLE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const ALLOWED_SETTING_KEYS = new Set([
  "schemaVersion",
  "containerNamePrefix",
  "startUrl",
  "oneTimePolicy",
  "reusablePolicy",
  "cleanup",
  "retry",
  "cleanupHistoryLimit",
]);

export class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  at: string,
) {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(`${at} contains unknown field: ${unknown.join(", ")}`);
  }
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  at: string,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new ValidationError(`${at} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new ValidationError(`${at} must be a boolean`);
  return value;
}

export function validateLifecyclePolicy(
  value: unknown,
  at = "policy",
): LifecyclePolicy {
  if (!isObject(value)) throw new ValidationError(`${at} must be an object`);
  assertOnlyKeys(
    value,
    ["destroyOnLastTabClose", "graceSeconds", "destroyOnBrowserRestart", "inactivity"],
    at,
  );
  if (!isObject(value["inactivity"])) {
    throw new ValidationError(`${at}.inactivity must be an object`);
  }
  assertOnlyKeys(value["inactivity"], ["enabled", "minutes"], `${at}.inactivity`);
  return {
    destroyOnLastTabClose: boolean(
      value["destroyOnLastTabClose"],
      `${at}.destroyOnLastTabClose`,
    ),
    graceSeconds:
      value["graceSeconds"] === undefined
        ? 0
        : numberInRange(
            value["graceSeconds"],
            0,
            MAX_GRACE_SECONDS,
            `${at}.graceSeconds`,
          ),
    destroyOnBrowserRestart: boolean(
      value["destroyOnBrowserRestart"],
      `${at}.destroyOnBrowserRestart`,
    ),
    inactivity: {
      enabled: boolean(value["inactivity"]["enabled"], `${at}.inactivity.enabled`),
      minutes: numberInRange(
        value["inactivity"]["minutes"],
        1,
        MAX_INACTIVITY_MINUTES,
        `${at}.inactivity.minutes`,
      ),
    },
  };
}

function validateStartUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new ValidationError(
      "settings.startUrl must be a URL of at most 2048 characters",
    );
  }
  if (value === "about:newtab" || value === "about:blank") return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError("settings.startUrl is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError(
      "settings.startUrl must use https, http, about:newtab, or about:blank",
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ValidationError("settings.startUrl must not include credentials");
  }
  return parsed.href;
}

export function validateSettings(value: unknown): Settings {
  if (!isObject(value)) throw new ValidationError("settings must be an object");
  const unknown = Object.keys(value).filter((key) => !ALLOWED_SETTING_KEYS.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(`settings contains unknown field: ${unknown.join(", ")}`);
  }
  if (value["schemaVersion"] !== STATE_SCHEMA_VERSION) {
    throw new ValidationError(
      `Unsupported settings schema: ${String(value["schemaVersion"])}`,
    );
  }
  if (
    typeof value["containerNamePrefix"] !== "string" ||
    !SAFE_NAME.test(value["containerNamePrefix"].trim())
  ) {
    throw new ValidationError(
      "settings.containerNamePrefix must be 1–30 visible characters",
    );
  }
  if (!isObject(value["cleanup"]))
    throw new ValidationError("settings.cleanup must be an object");
  assertOnlyKeys(value["cleanup"], ["eraseDownloadMetadata"], "settings.cleanup");
  if (!isObject(value["retry"]))
    throw new ValidationError("settings.retry must be an object");
  assertOnlyKeys(value["retry"], ["maxAttempts", "delaysMinutes"], "settings.retry");
  if (!Array.isArray(value["retry"]["delaysMinutes"])) {
    throw new ValidationError("settings.retry.delaysMinutes must be an array");
  }
  const maxAttempts = numberInRange(
    value["retry"]["maxAttempts"],
    1,
    10,
    "settings.retry.maxAttempts",
  );
  if (
    value["retry"]["delaysMinutes"].length < maxAttempts ||
    value["retry"]["delaysMinutes"].length > 10
  ) {
    throw new ValidationError(
      "settings.retry.delaysMinutes must contain maxAttempts to 10 entries",
    );
  }
  const delaysMinutes = value["retry"]["delaysMinutes"].map((delay, index) =>
    numberInRange(delay, 1, 1_440, `settings.retry.delaysMinutes[${index}]`),
  );
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    containerNamePrefix: value["containerNamePrefix"].trim(),
    startUrl: validateStartUrl(value["startUrl"]),
    oneTimePolicy: validateLifecyclePolicy(
      value["oneTimePolicy"],
      "settings.oneTimePolicy",
    ),
    reusablePolicy: validateLifecyclePolicy(
      value["reusablePolicy"],
      "settings.reusablePolicy",
    ),
    cleanup: {
      eraseDownloadMetadata: boolean(
        value["cleanup"]["eraseDownloadMetadata"],
        "settings.cleanup.eraseDownloadMetadata",
      ),
    },
    retry: { maxAttempts, delaysMinutes },
    cleanupHistoryLimit: numberInRange(
      value["cleanupHistoryLimit"],
      0,
      500,
      "settings.cleanupHistoryLimit",
    ),
  };
}

export function parseSettingsExport(text: string): Settings {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new ValidationError("Import exceeds 64 KiB");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("Import is not valid JSON");
  }
  if (!isObject(value)) throw new ValidationError("Import must be an object");
  assertOnlyKeys(value, ["format", "version", "exportedAt", "settings"], "import");
  if (
    value["format"] !== "ephemeral-settings" ||
    value["version"] !== SETTINGS_EXPORT_VERSION
  ) {
    throw new ValidationError("Unsupported Ephemeral settings export");
  }
  if (
    typeof value["exportedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["exportedAt"]))
  ) {
    throw new ValidationError("Import has an invalid exportedAt value");
  }
  return validateSettings(value["settings"]);
}

export function createSettingsExport(
  settings: Settings,
  now = Date.now(),
): SettingsExport {
  return {
    format: "ephemeral-settings",
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    settings: validateSettings(settings),
  };
}

export function sanitizeStyleName(value: string, fallback: string): string {
  return SAFE_STYLE_NAME.test(value) ? value : fallback;
}

export function migrateSettings(value: unknown): Settings {
  if (value === undefined) return createDefaultSettings();
  return validateSettings(value);
}
