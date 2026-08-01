import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const root = path.resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const addon = path.join(root, `artifacts/ephemeral-test-${packageJson.version}.zip`);
const extensionId = "ephemeral@astarling-x.github.io";
const extensionUuid = "8cb2e518-31d1-4a87-9ae8-2b127fcd3ee1";
const port = 17_779;

const server = createServer((request, response) => {
  if (request.url === "/sw.js") {
    response.writeHead(200, {
      "content-type": "text/javascript",
      "service-worker-allowed": "/",
    });
    response.end("self.addEventListener('fetch', () => undefined);");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "set-cookie": "ephemeral_e2e=present; Path=/; SameSite=Lax",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>Storage fixture</title>
<script>
localStorage.setItem("ephemeral-e2e", "present");
const request = indexedDB.open("ephemeral-e2e", 1);
request.onupgradeneeded = () => request.result.createObjectStore("values");
request.onsuccess = () => {
  const tx = request.result.transaction("values", "readwrite");
  tx.objectStore("values").put("present", "key");
};
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
</script><p id="fixture">ready</p>`);
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

// Firefox 153+ requires this explicit test-process opt-in before Marionette may
// use chrome context to open a moz-extension page. It is never a profile pref.
process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";

const options = new firefox.Options();
options.addArguments("-headless");
if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
options.setPreference(
  "extensions.webextensions.uuids",
  JSON.stringify({ [extensionId]: extensionUuid }),
);
options.setPreference("extensions.webextensions.keepStorageOnUninstall", false);
options.setPreference("privacy.userContext.enabled", true);

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(options)
  .build();

async function extensionMessage(message) {
  return driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     browser.runtime.sendMessage(arguments[0]).then(done, error => done({ok:false,error:String(error)}));`,
    message,
  );
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for extension state");
}

async function openTrustedExtensionPage(relativePath) {
  const url = `moz-extension://${extensionUuid}/${relativePath}`;
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    `const tab = window.gBrowser.addTrustedTab(arguments[0]);
     window.gBrowser.selectedTab = tab;`,
    url,
  );
  await driver.setContext(firefox.Context.CONTENT);
  // Select the window by URL rather than by handle exclusion: the onboarding
  // tab opens asynchronously on install and can otherwise be mistaken for
  // the newly opened extension page.
  const handle = await waitFor(async () => {
    const candidates = await driver.getAllWindowHandles();
    for (const candidate of candidates) {
      await driver.switchTo().window(candidate);
      if ((await driver.getCurrentUrl()).startsWith(url)) return candidate;
    }
    return undefined;
  }, 15_000);
  if (handle === undefined) {
    throw new Error(`Could not find extension window for ${relativePath}`);
  }
  await driver.switchTo().window(handle);
  return handle;
}

try {
  const initialHandle = await driver.getWindowHandle();
  await driver.installAddon(addon, true);
  const driverHandle = await openTrustedExtensionPage("test/index.html");
  await driver.wait(until.elementLocated(By.id("ready")), 15_000);

  // The extension opens an onboarding tab on install. Close that window so
  // later window-handle bookkeeping only sees windows created by the test.
  const onboardingHandle = (await driver.getAllWindowHandles()).find(
    (handle) => handle !== initialHandle && handle !== driverHandle,
  );
  if (onboardingHandle) {
    await driver.switchTo().window(onboardingHandle);
    if ((await driver.getCurrentUrl()).includes("onboarding/index.html")) {
      await driver.close();
      await driver.switchTo().window(driverHandle);
    }
  }

  const optionsHandle = await openTrustedExtensionPage("options/index.html");
  await driver.wait(
    until.elementLocated(By.css('body[data-app-state="ready"]')),
    10_000,
  );
  assert.equal(await driver.findElement(By.id("health")).getText(), "Ready");
  assert.equal(await driver.findElement(By.id("metric-active")).getText(), "0");
  assert.equal(await driver.findElement(By.id("error-panel")).isDisplayed(), false);
  await driver.close();
  await driver.switchTo().window(driverHandle);

  const popupHandle = await openTrustedExtensionPage("popup/index.html");
  await driver.wait(
    until.elementLocated(By.css('body[data-app-state="ready"]')),
    10_000,
  );
  assert.equal(await driver.findElement(By.id("health")).getText(), "Ready");
  assert.equal(await driver.findElement(By.id("active-count")).getText(), "0");
  await driver.close();
  await driver.switchTo().window(driverHandle);
  assert.notEqual(optionsHandle, popupHandle);

  // Regression: Firefox rejects an explicit about:newtab URL when
  // cookieStoreId is present. Configure that value and verify the adapter
  // omits the URL so Firefox creates its native container New Tab page.
  let response = await extensionMessage({ type: "GET_STATE" });
  assert.equal(response.ok, true, response.error);
  response = await extensionMessage({
    type: "UPDATE_SETTINGS",
    settings: { ...response.data.settings, startUrl: "about:newtab" },
  });
  assert.equal(response.ok, true, response.error);
  const handlesBeforeNativeTab = new Set(await driver.getAllWindowHandles());
  response = await extensionMessage({
    type: "CREATE_CONTAINER",
    kind: "reusable",
    openTab: true,
  });
  assert.equal(response.ok, true, response.error);
  const nativeTabHandle = await waitFor(async () =>
    (await driver.getAllWindowHandles()).find(
      (handle) => !handlesBeforeNativeTab.has(handle),
    ),
  );
  await driver.switchTo().window(nativeTabHandle);
  assert.match(await driver.getCurrentUrl(), /^about:(?:newtab|blank)/u);
  await driver.switchTo().window(driverHandle);
  response = await extensionMessage({ type: "GET_STATE" });
  const nativeContainer = response.data.containers.find(
    (record) => record.kind === "reusable",
  );
  assert.equal(nativeContainer.tabCount, 1);
  response = await extensionMessage({
    type: "CLEANUP_CONTAINER",
    containerId: nativeContainer.id,
  });
  assert.equal(response.ok, true, response.error);
  await waitFor(
    async () => !(await driver.getAllWindowHandles()).includes(nativeTabHandle),
  );

  // A dedicated ephemeral window: Firefox must open a new browser window in
  // its own container, and closing that window must trigger cleanup.
  const handlesBeforeWindow = new Set(await driver.getAllWindowHandles());
  response = await extensionMessage({
    type: "CREATE_WINDOW",
    kind: "one-time",
    url: `http://127.0.0.1:${port}/`,
  });
  assert.equal(response.ok, true, response.error);
  const windowHandle = await waitFor(async () =>
    (await driver.getAllWindowHandles()).find(
      (handle) => !handlesBeforeWindow.has(handle),
    ),
  );
  assert.ok(windowHandle);
  await driver.switchTo().window(windowHandle);
  await driver.wait(until.elementLocated(By.id("fixture")), 10_000);
  await driver.switchTo().window(driverHandle);
  response = await extensionMessage({ type: "GET_STATE" });
  const windowContainer = response.data.containers.find(
    (record) => record.kind === "one-time",
  );
  assert.ok(windowContainer);
  assert.equal(windowContainer.tabCount, 1);
  await driver.switchTo().window(windowHandle);
  await driver.close();
  await driver.switchTo().window(driverHandle);
  await waitFor(async () => {
    const state = await extensionMessage({ type: "GET_STATE" });
    return !state.data.containers.some((record) => record.id === windowContainer.id);
  }, 15_000);

  response = await extensionMessage({
    type: "CREATE_CONTAINER",
    kind: "one-time",
    openTab: false,
  });
  assert.equal(response.ok, true, response.error);
  response = await extensionMessage({ type: "GET_STATE" });
  const container = response.data.containers[0];
  assert.ok(container.cookieStoreId.startsWith("firefox-container-"));

  await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     browser.tabs.create({cookieStoreId: arguments[0], url: arguments[1]}).then(tab => done(tab.id), error => done({error:String(error)}));`,
    container.cookieStoreId,
    `http://127.0.0.1:${port}/`,
  );
  await waitFor(async () => (await driver.getAllWindowHandles()).length >= 3);
  // Select the fixture window by URL rather than by exclusion: the ordering of
  // window handles is not guaranteed, and other extension windows (onboarding,
  // popup) may still be open at this point.
  const fixtureHandle = await waitFor(async () => {
    const candidates = await driver.getAllWindowHandles();
    for (const handle of candidates) {
      await driver.switchTo().window(handle);
      if ((await driver.getCurrentUrl()).startsWith(`http://127.0.0.1:${port}/`)) {
        return handle;
      }
    }
    return undefined;
  }, 10_000);
  assert.ok(fixtureHandle);
  await driver.switchTo().window(fixtureHandle);
  await driver.wait(until.elementLocated(By.id("fixture")), 10_000);
  assert.equal(
    await driver.executeScript("return localStorage.getItem('ephemeral-e2e')"),
    "present",
  );
  assert.match(
    await driver.executeScript("return document.cookie"),
    /ephemeral_e2e=present/,
  );
  await driver.close();
  await driver.switchTo().window(driverHandle);

  const cleaned = await waitFor(async () => {
    const state = await extensionMessage({ type: "GET_STATE" });
    return state.data.containers.length === 0 ? state.data : undefined;
  });
  assert.equal(cleaned.cleanupHistory[0].outcome, "completed-with-limitations");
  assert.ok(
    cleaned.cleanupHistory[0].steps.some((step) => step.name === "scoped-site-data"),
  );

  const invalid = await extensionMessage({
    type: "IMPORT_SETTINGS",
    text: '{"bad":true}',
  });
  assert.equal(invalid.ok, false);
  console.log(
    "Firefox E2E passed: popup/dashboard boot, native container New Tab, isolation, storage fixture, ephemeral window, lifecycle cleanup, and import rejection.",
  );
} finally {
  await driver.quit().catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
}
