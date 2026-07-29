import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "build/manifest.json"), "utf8"),
);
const isTest = process.argv.includes("--test");
const filename = `ephemeral-${isTest ? "test-" : ""}${manifest.version}.zip`;
const output = path.join(root, "artifacts", filename);
const child = spawn(
  "python3",
  [path.join(root, "scripts/deterministic_zip.py"), path.join(root, "build"), output],
  { stdio: "inherit" },
);
const status = await new Promise((resolve) => child.on("exit", resolve));
if (status !== 0) process.exit(Number(status) || 1);
console.log(`Packaged ${path.relative(root, output)}`);
