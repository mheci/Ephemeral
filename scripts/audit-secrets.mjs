import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const scanHistory = process.argv.includes("--history");
const forbiddenNames = [
  /(^|\/)\.env(?:\.|$)/u,
  /(^|\/)(?:id_rsa|id_ed25519)$/u,
  /\.(?:key|p12|pfx|pem)$/iu,
];
const patterns = [
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/u],
  ["GitHub token", /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/u],
  ["AWS access key", /AKIA[0-9A-Z]{16}/u],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/u],
  ["npm token", /npm_[A-Za-z0-9]{30,}/u],
  ["AMO issuer", /user:[0-9]{5,}:[0-9]+/u],
  [
    "assigned secret",
    /(?:JWT_SECRET|API_SECRET|PRIVATE_KEY|CLIENT_SECRET)\s*[:=]\s*["'][^"'\r\n]{16,}["']/iu,
  ],
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function findingsIn(text) {
  return patterns.flatMap(([name, pattern]) => (pattern.test(text) ? [name] : []));
}

const failures = [];
for (const relative of trackedFiles()) {
  if (forbiddenNames.some((pattern) => pattern.test(relative))) {
    failures.push(`${relative}: forbidden credential-like filename`);
    continue;
  }
  const buffer = await readFile(path.join(root, relative));
  if (buffer.includes(0) || buffer.byteLength > 2_000_000) continue;
  for (const finding of findingsIn(buffer.toString("utf8"))) {
    failures.push(`${relative}: ${finding}`);
  }
}

if (scanHistory) {
  const history = execFileSync(
    "git",
    ["log", "--all", "-p", "--no-ext-diff", "--text", "--format=commit:%H"],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  ).toString("utf8");
  for (const finding of findingsIn(history)) failures.push(`git history: ${finding}`);
}

if (failures.length > 0) {
  console.error(
    `Secret audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(
  `Secret audit passed for tracked files${scanHistory ? " and complete git history" : ""}.`,
);
