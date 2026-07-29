import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { verifyBuild } from "./verify-build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "build");
const watch = process.argv.includes("--watch");
const testBuild = process.env.EPHEMERAL_TEST_BUILD === "1";

async function copyStatic() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all([
    cp(path.join(root, "src/manifest.json"), path.join(output, "manifest.json")),
    cp(path.join(root, "src/ui.css"), path.join(output, "ui.css")),
    cp(path.join(root, "src/icons"), path.join(output, "icons"), { recursive: true }),
    cp(path.join(root, "src/popup/index.html"), path.join(output, "popup/index.html")),
    cp(path.join(root, "src/popup/popup.css"), path.join(output, "popup/popup.css")),
    cp(
      path.join(root, "src/options/index.html"),
      path.join(output, "options/index.html"),
    ),
    cp(
      path.join(root, "src/options/options.css"),
      path.join(output, "options/options.css"),
    ),
  ]);
  if (testBuild) {
    await cp(path.join(root, "tests/e2e/driver"), path.join(output, "test"), {
      recursive: true,
    });
    const manifestPath = path.join(output, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.web_accessible_resources = [
      { resources: ["test/*"], matches: ["http://localhost/*"] },
    ];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

const common = {
  bundle: true,
  charset: "utf8",
  format: "iife",
  legalComments: "none",
  minify: false,
  platform: "browser",
  sourcemap: false,
  target: ["firefox153"],
};

const targets = [
  {
    entryPoints: [path.join(root, "src/background/index.ts")],
    outfile: path.join(output, "background.js"),
  },
  {
    entryPoints: [path.join(root, "src/popup/popup.ts")],
    outfile: path.join(output, "popup/popup.js"),
  },
  {
    entryPoints: [path.join(root, "src/options/options.ts")],
    outfile: path.join(output, "options/options.js"),
  },
];

await copyStatic();
if (watch) {
  const contexts = await Promise.all(
    targets.map((target) => context({ ...common, ...target })),
  );
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  console.log("Watching Ephemeral sources…");
} else {
  await Promise.all(targets.map((target) => build({ ...common, ...target })));
  await verifyBuild();
  console.log(`Built Ephemeral${testBuild ? " test" : ""} extension in build/`);
}
