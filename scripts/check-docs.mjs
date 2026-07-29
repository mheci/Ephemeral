import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const markdownFiles = execFileSync("git", ["ls-files", "*.md"], { cwd: root })
  .toString("utf8")
  .split("\n")
  .filter(Boolean);
const failures = [];

for (const relative of markdownFiles) {
  const text = await readFile(path.join(root, relative), "utf8");
  const targets = [
    ...[...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map(
      (match) => match[1],
    ),
    ...[...text.matchAll(/<img\s+[^>]*src=["']([^"']+)["']/giu)].map(
      (match) => match[1],
    ),
  ];
  for (const target of targets) {
    if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
    const decoded = decodeURIComponent(target.split("#", 1)[0]);
    try {
      await access(path.resolve(root, path.dirname(relative), decoded));
    } catch {
      failures.push(`${relative}: ${target}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Broken local documentation links:\n${failures.map((item) => `- ${item}`).join("\n")}`,
  );
}
console.log(`Documentation check passed for ${markdownFiles.length} files.`);
