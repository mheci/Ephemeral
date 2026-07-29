import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILD = path.join(ROOT, "build");

async function assertFile(file, context) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error("empty or not a file");
  } catch (error) {
    throw new Error(`${context}: missing ${path.relative(BUILD, file)}`, {
      cause: error,
    });
  }
}

function localReferences(html) {
  const references = [];
  const pattern = /\b(?:src|href)=["']([^"']+)["']/gu;
  for (const match of html.matchAll(pattern)) {
    const value = match[1];
    if (
      !value ||
      value.startsWith("#") ||
      value.startsWith("data:") ||
      value.includes(":")
    ) {
      continue;
    }
    references.push(value.split(/[?#]/u, 1)[0]);
  }
  return references;
}

function manifestPaths(manifest) {
  return [
    ...(manifest.background?.scripts ?? []),
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.action?.theme_icons ?? []).flatMap((icon) => [icon.light, icon.dark]),
    ...Object.values(manifest.icons ?? {}),
    manifest.options_ui?.page,
  ].filter((value) => typeof value === "string");
}

export async function verifyBuild() {
  const manifest = JSON.parse(
    await readFile(path.join(BUILD, "manifest.json"), "utf8"),
  );
  const expectedEntries = [
    "background.js",
    "popup/popup.js",
    "options/options.js",
    "popup/index.html",
    "options/index.html",
  ];
  for (const relative of [...expectedEntries, ...manifestPaths(manifest)]) {
    await assertFile(path.resolve(BUILD, relative), "manifest/build entry");
  }

  for (const relative of ["popup/index.html", "options/index.html"]) {
    const file = path.join(BUILD, relative);
    const html = await readFile(file, "utf8");
    for (const reference of localReferences(html)) {
      const target = path.resolve(path.dirname(file), reference);
      if (!target.startsWith(`${BUILD}${path.sep}`)) {
        throw new Error(`${relative}: resource escapes build root: ${reference}`);
      }
      await assertFile(target, relative);
    }
  }

  const production = process.env.EPHEMERAL_TEST_BUILD !== "1";
  if (production) {
    const files = await readdir(BUILD, { recursive: true });
    const forbidden = files.filter((file) =>
      /(^|\/)(test|tests)(\/|$)|\.(?:map|wasm)$/u.test(file),
    );
    if (forbidden.length > 0)
      throw new Error(`Forbidden production files: ${forbidden.join(", ")}`);
  }

  if (
    !manifest.content_security_policy?.extension_pages?.includes("connect-src 'none'")
  ) {
    throw new Error("Production CSP must block outbound extension-page connections");
  }
  console.log("Build resource and policy verification passed.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyBuild();
}
