import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const output = path.join(
  root,
  "artifacts",
  `ephemeral-${packageJson.version}-source.zip`,
);
const excludes = [
  ".git",
  ".arena",
  "artifacts",
  "build",
  "coverage",
  "node_modules",
].flatMap((name) => ["--exclude", name]);
const child = spawn(
  "python3",
  [path.join(root, "scripts/deterministic_zip.py"), root, output, ...excludes],
  { stdio: "inherit" },
);
const status = await new Promise((resolve) => child.on("exit", resolve));
if (status !== 0) process.exit(Number(status) || 1);
console.log(`Packaged ${path.relative(root, output)}`);
