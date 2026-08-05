const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function randomToken(length = 6): string {
  const size = TOKEN_ALPHABET.length;
  const limit = 256 - (256 % size);
  const buffer = new Uint8Array(1);
  let token = "";
  while (token.length < length) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value === undefined || value >= limit) continue;
    token += TOKEN_ALPHABET[value % size] ?? "A";
  }
  return token;
}

export function containerName(prefix: string, token: string): string {
  return `${prefix} · ${token}`;
}
