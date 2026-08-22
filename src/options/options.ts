import type {
  CleanupHistoryEntry,
  ContainerView,
  LifecyclePolicy,
  PublicState,
  Settings,
} from "../core/types";
import {
  countdownText,
  downloadText,
  errorText,
  formatDuration,
  relativeTime,
  send,
  setBusy,
} from "../ui/client";
import { clear, element, node } from "../ui/dom";
import { notify } from "../ui/notifications";

const COLOR_MAP: Readonly<Record<string, string>> = Object.freeze({
  blue: "#3778c2",
  cyan: "#16a3ad",
  green: "#2e8b57",
  orange: "#d47716",
  pink: "#c44e88",
  purple: "#7759b7",
  red: "#c23b3b",
  violet: "#7050bd",
  yellow: "#b58a00",
  gray: "#6b757b",
  turquoise: "#16a3ad",
  toolbar: "#6b757b",
});

let current: PublicState | undefined;
let refreshGeneration = 0;
let scheduledRefresh: number | undefined;
let uiBound = false;
let drainChips: Array<{ deadline: number; el: HTMLElement }> = [];
let drainTicker: number | undefined;

function startDrainTicker(): void {
  if (drainTicker !== undefined) return;
  drainTicker = window.setInterval(() => {
    if (drainChips.length === 0) {
      window.clearInterval(drainTicker);
      drainTicker = undefined;
      return;
    }
    for (const chip of drainChips) chip.el.textContent = countdownText(chip.deadline);
  }, 1_000);
}

function input(id: string): HTMLInputElement {
  return element<HTMLInputElement>(`#${id}`);
}

function setAppState(state: "booting" | "ready" | "error", error?: unknown): void {
  document.body.dataset["appState"] = state;
  const startup = element<HTMLElement>("#startup-panel");
  const failure = element<HTMLElement>("#error-panel");
  const content = element<HTMLElement>("#dashboard-content");
  startup.hidden = state !== "booting";
  failure.hidden = state !== "error";
  content.setAttribute("aria-busy", String(state === "booting"));
  if (state === "error") {
    element<HTMLElement>("#error-message").textContent = errorText(error);
    const health = element<HTMLElement>("#health");
    health.textContent = "Unavailable";
    health.dataset["level"] = "degraded";
  }
}

function setPolicy(prefix: "once" | "reuse", policy: LifecyclePolicy): void {
  input(`${prefix}-last-tab`).checked = policy.destroyOnLastTabClose;
  input(`${prefix}-grace`).value = String(policy.graceSeconds);
  input(`${prefix}-restart`).checked = policy.destroyOnBrowserRestart;
  input(`${prefix}-inactivity`).checked = policy.inactivity.enabled;
  input(`${prefix}-minutes`).value = String(policy.inactivity.minutes);
}

function readPolicy(prefix: "once" | "reuse"): LifecyclePolicy {
  return {
    destroyOnLastTabClose: input(`${prefix}-last-tab`).checked,
    graceSeconds: Number(input(`${prefix}-grace`).value),
    destroyOnBrowserRestart: input(`${prefix}-restart`).checked,
    inactivity: {
      enabled: input(`${prefix}-inactivity`).checked,
      minutes: Number(input(`${prefix}-minutes`).value),
    },
  };
}

function anyPanicPending(state: PublicState): boolean {
  return state.containers.some(
    (record) => record.status === "active" && record.panicDeadline !== undefined,
  );
}

function panicCountdownText(deadline: number): string {
  return countdownText(deadline, Date.now(), "wipes");
}

function renderSettings(state: PublicState): void {
  input("name-prefix").value = state.settings.containerNamePrefix;
  input("start-url").value = state.settings.startUrl;
  input("history-limit").value = String(state.settings.cleanupHistoryLimit);
  input("panic-grace").value = String(state.settings.panicGraceSeconds);
  input("download-metadata").checked = state.settings.cleanup.eraseDownloadMetadata;
  input("sweep-global-history").checked = state.settings.cleanup.sweepGlobalHistory;
  setPolicy("once", state.settings.oneTimePolicy);
  setPolicy("reuse", state.settings.reusablePolicy);

  const permission = element<HTMLElement>("#downloads-permission-status");
  permission.textContent = state.capabilities.downloadsPermission
    ? "Permission granted. Cleanup is still controlled by the switch above."
    : "Permission not granted. Enabling the switch asks Firefox once.";
  element<HTMLButtonElement>("#revoke-downloads").disabled =
    !state.capabilities.downloadsPermission;
}

function inlineCheck(
  label: string,
  checked: boolean,
): [HTMLLabelElement, HTMLInputElement] {
  const wrapper = node("label", { className: "check" });
  const checkbox = node("input", { attrs: { type: "checkbox" } });
  checkbox.checked = checked;
  wrapper.append(checkbox, node("span", { text: label }));
  return [wrapper, checkbox];
}

function policyChips(record: ContainerView): string[] {
  const chips = [`${record.tabCount} tab${record.tabCount === 1 ? "" : "s"}`];
  if (record.policy.destroyOnLastTabClose) chips.push("Last tab");
  if (record.expiresAt !== undefined)
    chips.push(`Expires ${relativeTime(record.expiresAt)}`);
  if (record.policy.destroyOnBrowserRestart) chips.push("Next startup");
  if (record.status !== "active") chips.push(record.status);
  return chips;
}

function sessionCard(record: ContainerView): HTMLElement {
  const card = node("article", { className: "session-card" });
  card.style.setProperty("--container-color", COLOR_MAP[record.color] ?? "#087f8c");

  const main = node("div", { className: "session-main" });
  const title = node("div", { className: "session-title" });
  title.append(
    node("span", { className: "session-orb", attrs: { "aria-hidden": "true" } }),
  );
  const titleCopy = node("div");
  titleCopy.append(
    node("h3", { text: record.name }),
    node("p", {
      text: `${record.kind === "one-time" ? "One-time disposable" : "Reusable temporary"} · created ${relativeTime(record.createdAt)}`,
    }),
  );
  title.append(titleCopy);

  const actions = node("div", { className: "session-actions" });
  const open = node("button", {
    className: "button secondary",
    text: "Open tab",
    attrs: { type: "button" },
  });
  const clean = node("button", {
    className: "button danger",
    text: record.status === "failed" ? "Retry cleanup" : "Clean now",
    attrs: { type: "button" },
  });
  open.disabled = record.status !== "active";
  open.addEventListener("click", () => {
    void run(open, () => send({ type: "OPEN_TAB", containerId: record.id }));
  });
  clean.addEventListener("click", () => {
    void run(clean, () => send({ type: "CLEANUP_CONTAINER", containerId: record.id }));
  });
  actions.append(open, clean);
  main.append(title, actions);
  card.append(main);

  const meta = node("div", { className: "session-meta" });
  for (const text of policyChips(record))
    meta.append(node("span", { className: "chip", text }));
  if (record.drainDeadline !== undefined) {
    const drain = node("span", {
      className: "chip drain-chip",
      text: countdownText(record.drainDeadline),
    });
    drainChips.push({ deadline: record.drainDeadline, el: drain });
    meta.append(drain);
  }
  if (record.panicDeadline !== undefined) {
    const panic = node("span", {
      className: "chip drain-chip panic-chip",
      text: panicCountdownText(record.panicDeadline),
      attrs: { role: "status" },
    });
    drainChips.push({ deadline: record.panicDeadline, el: panic });
    meta.append(panic);
  }
  card.append(meta);

  const policy = node("div", { className: "session-policy" });
  const [lastLabel, last] = inlineCheck(
    "Last tab",
    record.policy.destroyOnLastTabClose,
  );
  const [restartLabel, restart] = inlineCheck(
    "Next startup",
    record.policy.destroyOnBrowserRestart,
  );
  const [idleLabel, idle] = inlineCheck("Inactivity", record.policy.inactivity.enabled);
  const minutes = node("input", {
    className: "minutes",
    attrs: {
      type: "number",
      min: "1",
      max: "10080",
      value: String(record.policy.inactivity.minutes),
      "aria-label": "Inactivity timeout in minutes",
    },
  });
  const grace = node("input", {
    className: "minutes",
    attrs: {
      type: "number",
      min: "0",
      max: "600",
      value: String(record.policy.graceSeconds),
      "aria-label": "Undo-close grace period in seconds (0 = immediate)",
    },
  });
  const save = node("button", {
    className: "button secondary",
    text: "Save session policy",
    attrs: { type: "button" },
  });
  save.addEventListener("click", () => {
    void run(save, () =>
      send({
        type: "UPDATE_CONTAINER_POLICY",
        containerId: record.id,
        policy: {
          destroyOnLastTabClose: last.checked,
          graceSeconds: Number(grace.value),
          destroyOnBrowserRestart: restart.checked,
          inactivity: { enabled: idle.checked, minutes: Number(minutes.value) },
        },
      }),
    );
  });
  policy.append(lastLabel, restartLabel, idleLabel, minutes, grace, save);
  card.append(policy);
  if (record.lastError)
    card.append(node("p", { className: "container-error", text: record.lastError }));
  return card;
}

function historyItem(entry: CleanupHistoryEntry): HTMLElement {
  const item = node("article", { className: "history-item" });
  const head = node("div", { className: "history-head" });
  const copy = node("div");
  copy.append(
    node("h3", { text: entry.containerName }),
    node("p", {
      text: `${entry.trigger} · attempt ${entry.attempt} · ${relativeTime(entry.finishedAt)} · ${formatDuration(entry.durationMs)}`,
    }),
  );
  const status = node("span", { className: "status-pill", text: entry.outcome });
  status.dataset["level"] = entry.outcome === "failed" ? "degraded" : "attention";
  head.append(copy, status);
  item.append(head);

  const details = node("details");
  details.append(node("summary", { text: `${entry.steps.length} cleanup steps` }));
  const list = node("ol", { className: "step-list" });
  for (const cleanupStep of entry.steps) {
    const row = node("li");
    row.append(
      node("strong", { text: `${cleanupStep.name}: ${cleanupStep.outcome}` }),
      node("small", { text: cleanupStep.detail }),
    );
    list.append(row);
  }
  details.append(list);
  if (entry.limitations.length > 0) {
    details.append(node("p", { text: `Limits: ${entry.limitations.join(" ")}` }));
  }
  if (entry.error)
    details.append(node("p", { className: "container-error", text: entry.error }));
  item.append(details);
  return item;
}

function emptyPanel(title: string, detail: string): HTMLElement {
  const panel = node("div", { className: "empty-panel" });
  panel.append(
    node("span", {
      className: "empty-icon",
      text: "◇",
      attrs: { "aria-hidden": "true" },
    }),
    node("h3", { text: title }),
    node("p", { text: detail }),
  );
  return panel;
}

function shortcutRow(name: string, description: string, shortcut: string): HTMLElement {
  const row = node("div", { className: "shortcut-row" });
  const copy = node("div");
  copy.append(node("strong", { text: name }), node("small", { text: description }));
  const key = node("span", {
    className: `shortcut-key ${shortcut ? "" : "empty"}`,
    text: shortcut || "Not set",
    attrs: { title: shortcut ? `Current: ${shortcut}` : "No shortcut assigned" },
  });
  row.append(copy, key);
  return row;
}

async function renderShortcuts(): Promise<void> {
  const list = element<HTMLElement>("#shortcuts-list");
  clear(list);
  try {
    const commands = await browser.commands.getAll();
    // Sort for stable display: popup first, then our custom commands
    const order: Record<string, number> = {
      _execute_action: 0,
      "open-ephemeral-tab": 1,
      "open-ephemeral-space": 2,
    };
    commands.sort((a, b) => (order[a.name ?? ""] ?? 99) - (order[b.name ?? ""] ?? 99));

    const descriptions: Record<string, string> = {
      _execute_action: "Open popup – quick access to new tabs and cleanup",
      "open-ephemeral-tab":
        "New ephemeral tab – isolated, auto-cleans on close (recommended: Ctrl+Shift+E)",
      "open-ephemeral-space":
        "New ephemeral space – stays open for multiple tabs, cleans on demand (Ctrl+Shift+U)",
    };

    for (const cmd of commands) {
      const cmdName = cmd.name ?? "";
      const friendlyName =
        cmdName === "_execute_action"
          ? "Open Ephemeral popup"
          : cmdName === "open-ephemeral-tab"
            ? "New ephemeral tab"
            : cmdName === "open-ephemeral-space"
              ? "New ephemeral space"
              : cmdName;
      const desc = descriptions[cmdName] ?? cmd.description ?? "";
      list.append(shortcutRow(friendlyName, desc, cmd.shortcut ?? ""));
    }

    if (commands.length === 0) {
      list.append(
        emptyPanel("No shortcuts found", "Firefox did not return any commands."),
      );
    }
  } catch (error) {
    clear(list);
    list.append(
      emptyPanel(
        "Could not load shortcuts",
        `Firefox error: ${errorText(error)}. Try refreshing.`,
      ),
    );
  }
}

function render(state: PublicState): void {
  current = state;
  drainChips = [];
  const health = element<HTMLElement>("#health");
  health.textContent = state.health.summary;
  health.dataset["level"] = state.health.level;
  element<HTMLElement>("#extension-version").textContent =
    browser.runtime.getManifest().version;

  element<HTMLElement>("#metric-active").textContent = String(state.containers.length);
  element<HTMLElement>("#metric-completed").textContent = String(
    state.cleanupHistory.length,
  );
  element<HTMLElement>("#metric-failed").textContent = String(
    state.health.failedCleanups,
  );
  element<HTMLElement>("#metric-downloads").textContent = state.settings.cleanup
    .eraseDownloadMetadata
    ? state.capabilities.downloadsPermission
      ? "On"
      : "Limited"
    : "Off";
  element<HTMLElement>("#metric-lifetime-sessions").textContent = String(
    state.lifetimeStats.containersCleaned,
  );
  element<HTMLElement>("#metric-lifetime-data").textContent = String(
    state.lifetimeStats.dataTypesErased,
  );
  element<HTMLElement>("#metric-lifetime-tabs").textContent = String(
    state.lifetimeStats.tabsClosed,
  );

  renderSettings(state);

  const active = element<HTMLElement>("#active-list");
  clear(active);
  if (state.containers.length === 0) {
    active.append(
      emptyPanel(
        "No temporary sessions",
        "Create a disposable tab or reusable temporary space from the overview.",
      ),
    );
  } else {
    for (const record of state.containers) active.append(sessionCard(record));
  }
  element<HTMLButtonElement>("#cleanup-all").disabled = state.containers.length === 0;
  const panicPending = anyPanicPending(state);
  const panicButton = element<HTMLButtonElement>("#panic-clean");
  panicButton.disabled = state.containers.length === 0 || panicPending;
  element<HTMLButtonElement>("#cancel-panic").hidden = !panicPending;

  const history = element<HTMLElement>("#history-list");
  clear(history);
  if (state.cleanupHistory.length === 0) {
    history.append(
      emptyPanel(
        "No cleanup records",
        "Completed and failed cleanup attempts will appear here.",
      ),
    );
  } else {
    for (const entry of state.cleanupHistory) history.append(historyItem(entry));
  }
  startDrainTicker();
}

async function refresh(options: { showBoot?: boolean } = {}): Promise<void> {
  const generation = ++refreshGeneration;
  if (options.showBoot || !current) setAppState("booting");
  try {
    const state = await send<PublicState>({ type: "GET_STATE" });
    if (generation !== refreshGeneration) return;
    render(state);
    setAppState("ready");
  } catch (error) {
    if (generation !== refreshGeneration) return;
    setAppState("error", error);
  }
}

function scheduleStateRefresh(): void {
  if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
  scheduledRefresh = window.setTimeout(() => {
    scheduledRefresh = undefined;
    void refresh();
  }, 120);
}

async function run(
  button: HTMLButtonElement,
  operation: () => Promise<unknown>,
): Promise<void> {
  setBusy(button, true);
  try {
    await operation();
    await refresh();
  } catch (error) {
    notify(errorText(error), "error");
  } finally {
    setBusy(button, false);
  }
}

function readSettings(): Settings {
  if (!current) throw new Error("Dashboard state is unavailable");
  return {
    ...current.settings,
    containerNamePrefix: input("name-prefix").value,
    startUrl: input("start-url").value,
    oneTimePolicy: readPolicy("once"),
    reusablePolicy: readPolicy("reuse"),
    cleanup: {
      eraseDownloadMetadata: input("download-metadata").checked,
      sweepGlobalHistory: input("sweep-global-history").checked,
    },
    cleanupHistoryLimit: Number(input("history-limit").value),
    panicGraceSeconds: Number(input("panic-grace").value),
  };
}

function bind(): void {
  if (uiBound) return;
  uiBound = true;

  element<HTMLButtonElement>("#refresh-dashboard").addEventListener(
    "click",
    (event) => {
      void run(event.currentTarget as HTMLButtonElement, () =>
        refresh({ showBoot: true }),
      );
    },
  );
  element<HTMLButtonElement>("#retry-dashboard").addEventListener("click", () => {
    void refresh({ showBoot: true });
  });

  const once = element<HTMLButtonElement>("#create-once");
  once.addEventListener("click", () => {
    void run(once, () =>
      send({ type: "CREATE_CONTAINER", kind: "one-time", openTab: true }),
    );
  });
  const reusable = element<HTMLButtonElement>("#create-reusable");
  reusable.addEventListener("click", () => {
    void run(reusable, () =>
      send({ type: "CREATE_CONTAINER", kind: "reusable", openTab: true }),
    );
  });
  const cleanupAll = element<HTMLButtonElement>("#cleanup-all");
  cleanupAll.addEventListener("click", () => {
    void run(cleanupAll, async () => {
      await send({ type: "CLEANUP_ALL" });
      notify("All managed sessions were processed.");
    });
  });

  const panicClean = element<HTMLButtonElement>("#panic-clean");
  panicClean.addEventListener("click", () => {
    if (!current || current.containers.length === 0) return;
    const seconds = current.settings.panicGraceSeconds;
    void run(panicClean, async () => {
      await send({ type: "PANIC_CLEAN" });
      notify(`Panic wipe armed – everything cleans in ${seconds}s.`);
    });
  });

  const cancelPanic = element<HTMLButtonElement>("#cancel-panic");
  cancelPanic.addEventListener("click", () => {
    void run(cancelPanic, async () => {
      await send({ type: "CANCEL_PANIC_CLEAN" });
      notify("Panic wipe cancelled. Nothing was erased.");
    });
  });

  element<HTMLFormElement>("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const button = element<HTMLButtonElement>("#save-settings");
    void run(button, async () => {
      await send({ type: "UPDATE_SETTINGS", settings: readSettings() });
      element<HTMLElement>("#settings-saved").textContent = "Saved";
      notify("Lifecycle defaults saved.");
    });
  });

  input("download-metadata").addEventListener("change", (event) => {
    const checkbox = event.currentTarget as HTMLInputElement;
    void (async () => {
      try {
        let enabled = checkbox.checked;
        if (enabled && !current?.capabilities.downloadsPermission) {
          enabled = await browser.permissions.request({ permissions: ["downloads"] });
        }
        checkbox.checked = enabled;
        if (current) {
          await send({
            type: "UPDATE_SETTINGS",
            settings: {
              ...current.settings,
              cleanup: { ...current.settings.cleanup, eraseDownloadMetadata: enabled },
            },
          });
        }
        await refresh();
      } catch (error) {
        checkbox.checked = false;
        notify(errorText(error), "error");
      }
    })();
  });

  const saveCleanup = element<HTMLButtonElement>("#save-cleanup");
  saveCleanup.addEventListener("click", () => {
    void run(saveCleanup, async () => {
      await send({ type: "UPDATE_SETTINGS", settings: readSettings() });
      notify("Cleanup settings saved.");
    });
  });

  const revoke = element<HTMLButtonElement>("#revoke-downloads");
  revoke.addEventListener("click", () => {
    void run(revoke, async () => {
      await send({ type: "REMOVE_DOWNLOADS_PERMISSION" });
      if (current) {
        await send({
          type: "UPDATE_SETTINGS",
          settings: {
            ...current.settings,
            cleanup: { ...current.settings.cleanup, eraseDownloadMetadata: false },
          },
        });
      }
      notify("Downloads permission revoked.");
    });
  });

  const clearHistory = element<HTMLButtonElement>("#clear-history");
  clearHistory.addEventListener("click", () => {
    void run(clearHistory, async () => {
      await send({ type: "CLEAR_HISTORY" });
      notify("Cleanup records cleared.");
    });
  });

  element<HTMLButtonElement>("#export-settings").addEventListener("click", () => {
    void send<string>({ type: "EXPORT_SETTINGS" })
      .then((text) => downloadText("ephemeral-settings.json", text))
      .catch((error: unknown) => notify(errorText(error), "error"));
  });
  element<HTMLButtonElement>("#export-diagnostics").addEventListener("click", () => {
    void send<string>({ type: "EXPORT_DIAGNOSTICS" })
      .then((text) => downloadText("ephemeral-diagnostics.json", text))
      .catch((error: unknown) => notify(errorText(error), "error"));
  });
  input("import-settings").addEventListener("change", (event) => {
    const picker = event.currentTarget as HTMLInputElement;
    const file = picker.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => send({ type: "IMPORT_SETTINGS", text }))
      .then(() => refresh())
      .then(() => notify("Settings imported."))
      .catch((error: unknown) => notify(errorText(error), "error"))
      .finally(() => {
        picker.value = "";
      });
  });

  // Shortcuts – invisible efficiency, one keypress = isolated tab
  element<HTMLButtonElement>("#open-shortcuts").addEventListener("click", () => {
    // Firefox does not allow direct opening of about:addons shortcuts page,
    // so we open about:addons and instruct user. This is the closest we can
    // get without host permissions, and keeps us local-only.
    void browser.tabs
      .create({ url: "about:addons" })
      .then(() =>
        notify(
          "Opened Add-ons Manager. Use the gear icon → Manage Extension Shortcuts to customize.",
          "success",
        ),
      )
      .catch((error: unknown) => notify(errorText(error), "error"));
  });
  element<HTMLButtonElement>("#refresh-shortcuts").addEventListener("click", () => {
    void renderShortcuts().catch((error: unknown) => notify(errorText(error), "error"));
  });

  browser.storage.onChanged.addListener(scheduleStateRefresh);
  browser.permissions.onAdded.addListener(scheduleStateRefresh);
  browser.permissions.onRemoved.addListener(scheduleStateRefresh);
  window.addEventListener(
    "pagehide",
    () => {
      browser.storage.onChanged.removeListener(scheduleStateRefresh);
      browser.permissions.onAdded.removeListener(scheduleStateRefresh);
      browser.permissions.onRemoved.removeListener(scheduleStateRefresh);
      if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
      if (drainTicker !== undefined) {
        window.clearInterval(drainTicker);
        drainTicker = undefined;
      }
    },
    { once: true },
  );

  // Initial shortcuts render – independent of main state refresh
  void renderShortcuts().catch(() => {
    // Best-effort, dashboard still usable if commands API fails
  });
}

window.addEventListener("error", (event) => {
  setAppState("error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  setAppState("error", event.reason);
});

try {
  bind();
  void refresh({ showBoot: true });
} catch (error) {
  setAppState("error", error);
}
