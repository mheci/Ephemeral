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

function createContextMenus(): void {
  // Best-effort: menus permission may be missing in tests, ignore errors
  try {
    // Remove existing to avoid duplicates on re-creation after restart
    void browser.menus.removeAll().then(() => {
      // Link context: open link URL in isolated ephemeral container
      browser.menus.create({
        id: "open-link-ephemeral-tab",
        title: "Open link in new ephemeral tab",
        contexts: ["link"],
      });
      browser.menus.create({
        id: "open-link-ephemeral-space",
        title: "Open link in new ephemeral space",
        contexts: ["link"],
      });
      // Page context: open current page in ephemeral
      browser.menus.create({
        id: "open-page-ephemeral-tab",
        title: "Open this page in new ephemeral tab",
        contexts: ["page"],
      });
    });
  } catch {
    // Ignore – menus API may be unavailable in some environments
  }
}

// Register synchronously so Firefox MV3 event-page wake-up can discover every listener.
browser.runtime.onStartup.addListener(() => {
  report(controller.onBrowserStartup(), "startup");
  createContextMenus();
});
browser.runtime.onInstalled.addListener(() => {
  report(controller.initialize(), "installed");
  createContextMenus();
});
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
    // _execute_action is handled by Firefox opening the popup
  });
}

// Context menu – more automated, right-click any link
if (browser.menus?.onClicked) {
  browser.menus.onClicked.addListener((info) => {
    // Debounce same as hotkeys
    const commandId = info.menuItemId as string;
    if (!shouldHandleCommand(`menu-${commandId}`)) return;

    if (info.menuItemId === "open-link-ephemeral-tab" && info.linkUrl) {
      report(
        controller.createContainerWithUrl("one-time", info.linkUrl, true),
        "menu-open-link-ephemeral-tab",
      );
    } else if (info.menuItemId === "open-link-ephemeral-space" && info.linkUrl) {
      report(
        controller.createContainerWithUrl("reusable", info.linkUrl, true),
        "menu-open-link-ephemeral-space",
      );
    } else if (info.menuItemId === "open-page-ephemeral-tab" && info.pageUrl) {
      report(
        controller.createContainerWithUrl("one-time", info.pageUrl, true),
        "menu-open-page-ephemeral-tab",
      );
    }
  });
}

report(controller.initialize(), "initialization");
createContextMenus();
