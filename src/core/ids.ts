const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function randomToken(length = 6): string {
  const size = TOKEN_ALPHABET.length;
  const values = crypto.getRandomValues(new Uint32Array(length));
  let token = "";
  for (const value of values) {
    const index = Math.floor((value / 0x1_0000_0000) * size);
    token += TOKEN_ALPHABET[index] ?? "A";
  }
  return token;
}

export function containerName(prefix: string, token: string): string {
  return `${prefix} · ${token}`;
}
