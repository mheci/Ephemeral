import type { RequestMessage, ResponseMessage } from "../core/types";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class UiRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UiRequestError";
  }
}

function isResponse(value: unknown): value is ResponseMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

export async function send<T = unknown>(
  message: RequestMessage,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: number | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => {
        reject(
          new UiRequestError(
            "Ephemeral did not respond in time. The background process may be restarting.",
            "REQUEST_TIMEOUT",
          ),
        );
      }, timeoutMs);
    });
    const raw: unknown = await Promise.race([
      browser.runtime.sendMessage(message),
      timeout,
    ]);
    if (!isResponse(raw)) {
      throw new UiRequestError(
        "Ephemeral returned an invalid response.",
        "INVALID_RESPONSE",
      );
    }
    if (!raw.ok) throw new UiRequestError(raw.error, raw.code);
    return raw.data as T;
  } catch (error) {
    if (error instanceof UiRequestError) throw error;
    throw new UiRequestError(
      error instanceof Error ? error.message : String(error),
      "TRANSPORT_ERROR",
      { cause: error },
    );
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const delta = timestamp - now;
  const absolute = Math.abs(delta);
  if (absolute < 60_000) return delta > 0 ? "in under a minute" : "just now";
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
  ];
  const fallback: [number, Intl.RelativeTimeFormatUnit] = [60_000, "minute"];
  const [size, unit] = units.find(([candidate]) => absolute >= candidate) ?? fallback;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(delta / size),
    unit,
  );
}

/** Live "cleans in 12s" text for drain/panic countdown chips. */
export function countdownText(
  deadline: number,
  now = Date.now(),
  verb = "cleans",
): string {
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1_000));
  if (remaining < 60) return `${verb} in ${remaining}s`;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return seconds === 0
    ? `${verb} in ${minutes}m`
    : `${verb} in ${minutes}m ${seconds}s`;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
