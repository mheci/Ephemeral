import type { CleanupHistoryEntry, ContainerView, PublicState } from "../core/types";
import {
  countdownText,
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

const ICON_PATHS = Object.freeze({
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
} as const);

function iconSvg(path: string): string {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

let current: PublicState | undefined;
let refreshGeneration = 0;
let scheduledRefresh: number | undefined;
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

function setAppState(state: "booting" | "ready" | "error", error?: unknown): void {
  document.body.dataset["appState"] = state;
  element<HTMLElement>("#startup-panel").hidden = state !== "booting";
  element<HTMLElement>("#error-panel").hidden = state !== "error";
  element<HTMLElement>("#popup-content").setAttribute(
    "aria-busy",
    String(state === "booting"),
  );
  if (state === "error") {
    element<HTMLElement>("#error-message").textContent = errorText(error);
    const health = element<HTMLElement>("#health");
    health.textContent = "Unavailable";
    health.dataset["level"] = "degraded";
  }
}

function policyChips(record: ContainerView): string[] {
  const chips = [`${record.tabCount} tab${record.tabCount === 1 ? "" : "s"}`];
  if (record.policy.destroyOnLastTabClose) chips.push("Last tab");
  if (record.expiresAt !== undefined) chips.push(relativeTime(record.expiresAt));
  if (record.policy.destroyOnBrowserRestart) chips.push("Next startup");
  return chips;
}

function sessionCard(record: ContainerView): HTMLElement {
  const card = node("article", { className: "popup-session-card" });
  card.style.setProperty("--container-color", COLOR_MAP[record.color] ?? "#087f8c");
  const main = node("div", { className: "popup-session-main" });
  const title = node("div", { className: "popup-session-title" });
  title.append(
    node("strong", { text: record.name }),
    node("small", {
      text: `${record.kind === "one-time" ? "One-time" : "Reusable"} · ${record.status}`,
    }),
  );
  const actions = node("div", { className: "popup-session-actions" });
  const open = node("button", {
    className: "popup-icon-button",
    title: "Open another tab",
    attrs: { type: "button", "aria-label": `Open a tab in ${record.name}` },
  });
  const clean = node("button", {
    className: "popup-icon-button danger",
    title: "Clean and destroy",
    attrs: { type: "button", "aria-label": `Clean and destroy ${record.name}` },
  });
  open.innerHTML = iconSvg(ICON_PATHS.plus);
  clean.innerHTML = iconSvg(ICON_PATHS.trash);
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

  const meta = node("div", { className: "popup-session-meta" });
  for (const text of policyChips(record)) {
    meta.append(node("span", { className: "popup-chip", text }));
  }
  if (record.drainDeadline !== undefined) {
    const drain = node("span", {
      className: "popup-chip drain-chip",
      text: countdownText(record.drainDeadline),
    });
    drainChips.push({ deadline: record.drainDeadline, el: drain });
    meta.append(drain);
  }
  card.append(meta);
  if (record.lastError)
    card.append(node("p", { className: "popup-error", text: record.lastError }));
  return card;
}

function recentItem(entry: CleanupHistoryEntry): HTMLElement {
  const item = node("div", { className: "recent-item" });
  const outcomeClass = entry.outcome === "failed" ? "failed" : "limited";
  item.append(
    node("span", { className: `outcome-dot ${outcomeClass}`, title: entry.outcome }),
    node("span", { text: entry.containerName }),
    node("small", {
      text: `${relativeTime(entry.finishedAt)} · ${formatDuration(entry.durationMs)}`,
    }),
  );
  return item;
}

function emptyState(title: string, detail: string): HTMLElement {
  const empty = node("div", { className: "popup-empty" });
  empty.append(
    node("span", { text: "◇", attrs: { "aria-hidden": "true" } }),
    node("strong", { text: title }),
    node("small", { text: detail }),
  );
  return empty;
}

function render(state: PublicState): void {
  current = state;
  drainChips = [];
  const health = element<HTMLElement>("#health");
  health.textContent = state.health.summary;
  health.dataset["level"] = state.health.level;
  element<HTMLElement>("#active-count").textContent = String(state.containers.length);
  element<HTMLElement>("#pending-count").textContent = String(
    state.health.pendingCleanups + state.health.failedCleanups,
  );

  const list = element<HTMLElement>("#container-list");
  clear(list);
  if (state.containers.length === 0) {
    list.append(
      emptyState("No temporary sessions", "Start one above when you need it."),
    );
  } else {
    for (const record of state.containers) list.append(sessionCard(record));
  }
  element<HTMLButtonElement>("#cleanup-all").hidden = state.containers.length === 0;

  const recent = element<HTMLElement>("#recent-cleanup");
  clear(recent);
  const entries = state.cleanupHistory.slice(0, 3);
  if (entries.length === 0) {
    recent.append(
      emptyState("No cleanup records", "Completed sessions will appear here."),
    );
  } else {
    for (const entry of entries) recent.append(recentItem(entry));
  }
  startDrainTicker();
}

async function refresh(showBoot = false): Promise<void> {
  const generation = ++refreshGeneration;
  if (showBoot || !current) setAppState("booting");
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
  }, 100);
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

const SHORTCUT_TARGETS = Object.freeze([
  { command: "open-ephemeral-tab", selector: "#create-once" },
  { command: "open-ephemeral-space", selector: "#create-reusable" },
  { command: "open-ephemeral-window", selector: "#create-window" },
] as const);

async function renderShortcutHints(): Promise<void> {
  try {
    const commands = await browser.commands.getAll();
    for (const { command, selector } of SHORTCUT_TARGETS) {
      const hint = element<HTMLElement>(`${selector} .shortcut-hint`);
      const shortcut = commands.find((entry) => entry.name === command)?.shortcut;
      hint.hidden = !shortcut;
      if (shortcut) hint.textContent = shortcut;
    }
  } catch {
    // Fall back to the static hints in the markup.
  }
}

function bind(): void {
  const once = element<HTMLButtonElement>("#create-once");
  once.addEventListener("click", () => {
    void run(once, async () => {
      await send({ type: "CREATE_CONTAINER", kind: "one-time", openTab: true });
      window.close();
    });
  });
  const reusable = element<HTMLButtonElement>("#create-reusable");
  reusable.addEventListener("click", () => {
    void run(reusable, async () => {
      await send({ type: "CREATE_CONTAINER", kind: "reusable", openTab: true });
      window.close();
    });
  });
  const createWindow = element<HTMLButtonElement>("#create-window");
  createWindow.addEventListener("click", () => {
    void run(createWindow, async () => {
      await send({ type: "CREATE_WINDOW", kind: "one-time" });
      window.close();
    });
  });
  const cleanupAll = element<HTMLButtonElement>("#cleanup-all");
  cleanupAll.addEventListener("click", () => {
    if (!current || current.containers.length === 0) return;
    void run(cleanupAll, async () => {
      await send({ type: "CLEANUP_ALL" });
      notify("All managed sessions were processed.");
    });
  });
  element<HTMLButtonElement>("#refresh-popup").addEventListener("click", (event) => {
    void run(event.currentTarget as HTMLButtonElement, () => refresh(true));
  });
  element<HTMLButtonElement>("#retry-popup").addEventListener("click", () => {
    void refresh(true);
  });
  element<HTMLButtonElement>("#open-options").addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
    window.close();
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
}

window.addEventListener("error", (event) => {
  setAppState("error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  setAppState("error", event.reason);
});

try {
  bind();
  void renderShortcutHints();
  void refresh(true);
} catch (error) {
  setAppState("error", error);
}
