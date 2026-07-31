import type { BrowserTab } from "./browser-adapter";
import { Controller } from "./controller";
import { FirefoxAdapter } from "./firefox-adapter";
import { MessageRouter } from "./message-router";

const controller = new Controller(new FirefoxAdapter());
const router = new MessageRouter(controller);

// Simple debounce for hotkey commands to avoid container spam when key held
const lastCommandTime = new Map<string, number>();
const COMMAND_DEBOUNCE_MS = 350;

function shouldHandleCommand(name: string): boolean {
  const now = Date.now();
  const last = lastCommandTime.get(name) ?? 0;
  if (now - last < COMMAND_DEBOUNCE_MS) return false;
  lastCommandTime.set(name, now);
  return true;
}

function report(task: Promise<unknown>, event: string): void {
  void task.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ephemeral] Background event failed", {
      event,
      error: message.slice(0, 500),
    });
  });
}

// Register synchronously so Firefox MV3 event-page wake-up can discover every listener.
browser.runtime.onStartup.addListener(() =>
  report(controller.onBrowserStartup(), "startup"),
);
browser.runtime.onInstalled.addListener(() =>
  report(controller.initialize(), "installed"),
);
browser.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  const value: BrowserTab = {
    id: tab.id,
    ...(tab.cookieStoreId ? { cookieStoreId: tab.cookieStoreId } : {}),
  };
  report(controller.onTabActivity(value), "tab-created");
});
browser.tabs.onActivated.addListener(({ tabId }) =>
  report(controller.onTabActivated(tabId), "tab-activated"),
);
browser.tabs.onRemoved.addListener((tabId) =>
  report(controller.onTabRemoved(tabId), "tab-removed"),
);
browser.alarms.onAlarm.addListener((alarm) =>
  report(controller.onAlarm(alarm.name), "alarm"),
);
browser.contextualIdentities.onRemoved.addListener(({ contextualIdentity }) =>
  report(
    controller.onIdentityRemoved(contextualIdentity.cookieStoreId),
    "identity-removed",
  ),
);
browser.runtime.onMessage.addListener((message, sender) =>
  router.handle(message, sender),
);

// Hotkey support: open ephemeral tabs/spaces directly, bypassing popup
// This makes the extension feel invisible – one keypress = isolated tab
if (browser.commands?.onCommand) {
  browser.commands.onCommand.addListener((command) => {
    if (!shouldHandleCommand(command)) return;
    if (command === "open-ephemeral-tab") {
      report(
        controller.createContainer("one-time", true),
        "command-open-ephemeral-tab",
      );
    } else if (command === "open-ephemeral-space") {
      report(
        controller.createContainer("reusable", true),
        "command-open-ephemeral-space",
      );
    }
    // _execute_action is handled by Firefox opening the popup, no need to handle here
  });
}

report(controller.initialize(), "initialization");
