import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "src/manifest.json");
const manifest = JSON.parse(await readFile(source, "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const requiredPermissions = new Set([
  "alarms",
  "browsingData",
  "contextualIdentities",
  "cookies",
  "storage",
]);
const errors = [];
if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (manifest.version !== packageJson.version)
  errors.push("manifest and package versions differ");
if (manifest.browser_specific_settings?.gecko?.strict_min_version !== "153.0") {
  errors.push("strict_min_version must match the Firefox 153 baseline");
}
if (
  JSON.stringify(
    manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required,
  ) !== JSON.stringify(["none"])
) {
  errors.push("manifest must declare required data collection permission none");
}
const actual = new Set(manifest.permissions ?? []);
if (
  actual.size !== requiredPermissions.size ||
  [...actual].some((permission) => !requiredPermissions.has(permission))
) {
  errors.push(
    "required permission set changed; update the security review and validator intentionally",
  );
}
if (JSON.stringify(manifest.optional_permissions) !== JSON.stringify(["downloads"])) {
  errors.push("only downloads may be optional");
}
if (manifest.host_permissions?.length)
  errors.push("host_permissions must remain empty");
if (manifest.content_scripts?.length) errors.push("content scripts are prohibited");
if (!manifest.content_security_policy?.extension_pages.includes("connect-src 'none'")) {
  errors.push("extension CSP must block outbound connections");
}
const paths = [
  ...Object.values(manifest.icons ?? {}),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...(manifest.background?.scripts ?? []),
].filter(Boolean);
for (const relative of paths) {
  const file =
    relative === "background.js"
      ? path.join(root, "build", relative)
      : path.join(root, "src", relative);
  if (relative === "background.js") continue;
  try {
    await access(file);
  } catch {
    errors.push(`missing manifest resource: ${relative}`);
  }
}
if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log("Manifest policy validation passed.");
