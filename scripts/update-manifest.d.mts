export const ADDON_ID: string;
export const DEFAULT_REPO: string;
export function buildUpdateManifest(
  releases: unknown,
  options?: { id?: string; repo?: string },
): {
  id: string;
  versions: Array<{ version: string; update_link: string; update_hash?: string }>;
};
