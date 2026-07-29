export class EphemeralError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EphemeralError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

export function isNotFoundError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("not found") || message.includes("no contextual identity");
}
