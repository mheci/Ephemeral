import { errorMessage } from "../core/errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Local console logging only. Messages must not contain URLs, cookies, or page data. */
export class Logger {
  public constructor(private readonly namespace = "ephemeral") {}

  public debug(
    message: string,
    context?: Record<string, string | number | boolean>,
  ): void {
    this.write("debug", message, context);
  }

  public info(
    message: string,
    context?: Record<string, string | number | boolean>,
  ): void {
    this.write("info", message, context);
  }

  public warn(
    message: string,
    context?: Record<string, string | number | boolean>,
  ): void {
    this.write("warn", message, context);
  }

  public error(message: string, error?: unknown): void {
    this.write(
      "error",
      message,
      error === undefined ? undefined : { error: errorMessage(error) },
    );
  }

  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, string | number | boolean>,
  ): void {
    const entry = context ? [message, context] : [message];
    console[level](`[${this.namespace}]`, ...entry);
  }
}
