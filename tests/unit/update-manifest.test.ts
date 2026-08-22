import { describe, expect, it } from "vitest";
import {
  ADDON_ID,
  DEFAULT_REPO,
  buildUpdateManifest,
} from "../../scripts/update-manifest.mjs";

type Release = Record<string, unknown>;

function release(tag: string, assets: string[], extra: Partial<Release> = {}): Release {
  return {
    tag_name: tag,
    draft: false,
    assets: assets.map((name) => ({ name, digest: `sha256:${name}` })),
    ...extra,
  };
}

describe("update manifest mapping", () => {
  it("maps signed releases to newest-first update entries with hashes", () => {
    const manifest = buildUpdateManifest([
      release("v2.1.0", ["ephemeral-2.1.0.zip"]),
      release("v2.3.0", ["ephemeral-2.3.0.zip", "ephemeral-2.3.0-signed.xpi"]),
      release("v2.2.1", ["ephemeral-2.2.1-signed.xpi"]),
    ]);
    expect(manifest.id).toBe(ADDON_ID);
    expect(manifest.versions).toEqual([
      {
        version: "2.3.0",
        update_link: `https://github.com/${DEFAULT_REPO}/releases/download/v2.3.0/ephemeral-2.3.0-signed.xpi`,
        update_hash: "sha256:ephemeral-2.3.0-signed.xpi",
      },
      {
        version: "2.2.1",
        update_link: `https://github.com/${DEFAULT_REPO}/releases/download/v2.2.1/ephemeral-2.2.1-signed.xpi`,
        update_hash: "sha256:ephemeral-2.2.1-signed.xpi",
      },
    ]);
  });

  it("skips drafts, non-semver tags, and releases without a signed XPI", () => {
    const manifest = buildUpdateManifest([
      release("v3.0.0", ["ephemeral-3.0.0-signed.xpi"], { draft: true }),
      release("nightly", ["ephemeral-nightly-signed.xpi"]),
      release("v1.9.9", ["ephemeral-1.9.9.zip", "SHA256SUMS"]),
    ]);
    expect(manifest.versions).toEqual([]);
  });

  it("omits update_hash when the API reports no sha256 digest", () => {
    const manifest = buildUpdateManifest([
      {
        tag_name: "v2.0.0",
        draft: false,
        assets: [{ name: "ephemeral-2.0.0-signed.xpi" }],
      },
    ]);
    expect(manifest.versions[0]).toEqual({
      version: "2.0.0",
      update_link: `https://github.com/${DEFAULT_REPO}/releases/download/v2.0.0/ephemeral-2.0.0-signed.xpi`,
    });
  });

  it("sorts semver numerically, not lexicographically", () => {
    const manifest = buildUpdateManifest([
      release("v2.10.0", ["ephemeral-2.10.0-signed.xpi"]),
      release("v2.9.0", ["ephemeral-2.9.0-signed.xpi"]),
    ]);
    expect(manifest.versions.map((entry) => entry.version)).toEqual([
      "2.10.0",
      "2.9.0",
    ]);
  });

  it("honors an explicit repository override", () => {
    const manifest = buildUpdateManifest(
      [release("v1.0.0", ["ephemeral-1.0.0-signed.xpi"])],
      { repo: "octocat/Ephemeral" },
    );
    expect(manifest.versions[0]?.update_link).toContain("octocat/Ephemeral");
  });

  it("rejects payloads that are not release arrays", () => {
    expect(() => buildUpdateManifest({})).toThrow(/must be an array/);
  });
});
