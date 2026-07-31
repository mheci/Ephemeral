import { errorMessage } from "../core/errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Local console logging only. Messages must not contain URLs, cookies, or page data.
 * For invisibility and resource efficiency, debug/info are no-ops in production builds.
 * Only warnings and errors are logged to console, and even those are rate-limited
 * to avoid spamming the console during rapid events.
 */
export class Logger {
  private lastWarnTime = 0;
  private readonly WARN_THROTTLE_MS = 5_000;

  public constructor(private readonly namespace = "ephemeral") {}

  public debug(
    _message: string,
    _context?: Record<string, string | number | boolean>,
  ): void {
    void _message;
    void _context;
    // No-op for invisibility – debug logs would make us visible and waste CPU
  }

  public info(
    _message: string,
    _context?: Record<string, string | number | boolean>,
  ): void {
    void _message;
    void _context;
    // No-op for efficiency – info logs not needed in production
  }

  public warn(
    message: string,
    context?: Record<string, string | number | boolean>,
  ): void {
    // Throttle warnings to avoid console spam during rapid tab events
    const now = Date.now();
    if (now - this.lastWarnTime < this.WARN_THROTTLE_MS) return;
    this.lastWarnTime = now;
    const entry = context ? [message, context] : [message];
    console.warn(`[${this.namespace}]`, ...entry);
  }

  public error(message: string, error?: unknown): void {
    console.error(
      `[${this.namespace}]`,
      message,
      error === undefined ? "" : { error: errorMessage(error) },
    );
  }
}
