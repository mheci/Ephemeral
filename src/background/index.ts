import type { BrowserTab } from "./browser-adapter";
import { Controller } from "./controller";
import { FirefoxAdapter } from "./firefox-adapter";
import { MessageRouter } from "./message-router";

const controller = new Controller(new FirefoxAdapter());
const router = new MessageRouter(controller);

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

report(controller.initialize(), "initialization");
