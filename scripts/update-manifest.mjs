#!/usr/bin/env node
/**
 * Firefox update manifest generator (the self-hosted update channel).
 *
 * Ephemeral is distributed as unlisted-signed XPIs on GitHub Releases. Firefox
 * can auto-update such an add-on only when the manifest declares
 * `browser_specific_settings.gecko.update_url` and that URL serves an update
 * manifest in the documented format:
 *
 *   { "id": "<gecko id>", "versions": [ { "version", "update_link", ... } ] }
 *
 * This script regenerates the whole manifest from the repository's published
 * GitHub releases, so it can never drift from what is actually downloadable:
 * every non-draft release that carries an `ephemeral-<version>-signed.xpi`
 * asset becomes one entry, newest first. When the release API reports a sha256
 * digest for the asset it is emitted as `update_hash` ("sha256:<hex>"), which
 * Firefox verifies before installing.
 *
 * Usage:
 *   node scripts/update-manifest.mjs [--out <path>] [--releases-json <path>]
 *                                    [--repo <owner/repo>]
 *
 * --releases-json reads a saved `gh api repos/<owner>/<repo>/releases`
 * response instead of calling `gh api` directly (used by tests and CI).
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ADDON_ID = "ephemeral@mheci.github.io";
export const DEFAULT_REPO = "mheci/Ephemeral";

/**
 * Build the update manifest from a GitHub releases API response array.
 *
 * Pure so the mapping rules are unit-testable without network access.
 * Releases are sorted newest-first by semver; drafts and releases without a
 * signed XPI asset are skipped (an update_link that 404s would strand the
 * updater).
 */
export function buildUpdateManifest(
  releases,
  { id = ADDON_ID, repo = DEFAULT_REPO } = {},
) {
  if (!Array.isArray(releases)) {
    throw new Error("releases payload must be an array");
  }
  const versions = [];
  for (const release of releases) {
    if (!release || release.draft === true) continue;
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    const version = tag.startsWith("v") ? tag.slice(1) : "";
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const xpi = assets.find(
      (asset) => asset.name === `ephemeral-${version}-signed.xpi`,
    );
    if (!xpi) continue;

    const entry = {
      version,
      update_link: `https://github.com/${repo}/releases/download/v${version}/${xpi.name}`,
    };
    if (typeof xpi.digest === "string" && xpi.digest.startsWith("sha256:")) {
      entry.update_hash = xpi.digest;
    }
    versions.push(entry);
  }
  versions.sort((a, b) => compareVersions(b.version, a.version));
  return { id, versions };
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
}

/** Fetch all published releases through the authenticated gh CLI. */
async function fetchReleases(repo) {
  const result = spawnSync("gh", ["api", "--paginate", `repos/${repo}/releases`], {
    encoding: "utf8",
  });
  if (result.error !== null && result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh api failed: ${String(result.stderr).trim()}`);
  }
  return JSON.parse(result.stdout);
}

function parseArgs(argv) {
  const args = { out: null, releasesJson: null, repo: DEFAULT_REPO };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--out":
        args.out = argv[++i];
        break;
      case "--releases-json":
        args.releasesJson = argv[++i];
        break;
      case "--repo":
        args.repo = argv[++i];
        break;
      default:
        throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const releases = args.releasesJson
      ? JSON.parse(await readFile(args.releasesJson, "utf8"))
      : await fetchReleases(args.repo);
    const manifest = buildUpdateManifest(releases, { repo: args.repo });
    if (manifest.versions.length === 0) {
      throw new Error(
        "no release with a signed XPI found — refusing to publish an empty channel",
      );
    }
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    if (args.out) {
      await writeFile(args.out, json);
      console.log(
        `[updates] wrote ${manifest.versions.length} entries (${manifest.versions[0].version} … ${
          manifest.versions[manifest.versions.length - 1].version
        }) to ${args.out}`,
      );
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    console.error("[updates]", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
