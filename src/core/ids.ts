const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function randomToken(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let token = "";
  for (const byte of bytes)
    token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length] ?? "A";
  return token;
}

export function containerName(prefix: string, token: string): string {
  return `${prefix} · ${token}`;
}
