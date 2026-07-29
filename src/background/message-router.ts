import { EphemeralError, errorMessage } from "../core/errors";
import type { RequestMessage, ResponseMessage } from "../core/types";
import type { Controller } from "./controller";

function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

export class MessageRouter {
  public constructor(private readonly controller: Controller) {}

  public async handle(
    message: unknown,
    sender: browser.runtime.MessageSender,
  ): Promise<ResponseMessage> {
    if (sender.id !== browser.runtime.id)
      return this.failure("UNAUTHORIZED", "Unauthorized sender");
    if (!isRequestMessage(message))
      return this.failure("BAD_REQUEST", "Invalid request");
    try {
      switch (message.type) {
        case "GET_STATE":
          return this.success(await this.controller.getPublicState());
        case "CREATE_CONTAINER":
          await this.controller.createContainer(message.kind, message.openTab);
          return this.success();
        case "OPEN_TAB":
          await this.controller.openTab(message.containerId);
          return this.success();
        case "CLEANUP_CONTAINER":
          return this.success(
            await this.controller.cleanupContainer(message.containerId),
          );
        case "CLEANUP_ALL":
          await this.controller.cleanupAll();
          return this.success();
        case "UPDATE_SETTINGS":
          await this.controller.updateSettings(message.settings);
          return this.success();
        case "UPDATE_CONTAINER_POLICY":
          await this.controller.updateContainerPolicy(
            message.containerId,
            message.policy,
          );
          return this.success();
        case "IMPORT_SETTINGS":
          await this.controller.importSettings(message.text);
          return this.success();
        case "EXPORT_SETTINGS":
          return this.success(await this.controller.exportSettings());
        case "EXPORT_DIAGNOSTICS":
          return this.success(await this.controller.exportDiagnostics());
        case "CLEAR_HISTORY":
          await this.controller.clearHistory();
          return this.success();
        case "REQUEST_DOWNLOADS_PERMISSION":
          return this.success(await this.controller.requestDownloadsPermission());
        case "REMOVE_DOWNLOADS_PERMISSION":
          return this.success(await this.controller.removeDownloadsPermission());
        default:
          return this.failure("BAD_REQUEST", "Unknown request type");
      }
    } catch (error) {
      const code = error instanceof EphemeralError ? error.code : "INTERNAL_ERROR";
      return this.failure(code, errorMessage(error));
    }
  }

  private success(data?: unknown): ResponseMessage {
    return data === undefined ? { ok: true } : { ok: true, data };
  }

  private failure(code: string, error: string): ResponseMessage {
    return { ok: false, code, error };
  }
}
