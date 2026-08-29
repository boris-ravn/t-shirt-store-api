import { createHash, randomBytes } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

// Refresh and password-reset tokens are hashed with a fast, deterministic
// digest, not bcrypt: the row is looked up by exact match
// (`WHERE token_hash = ?`), which bcrypt's per-call salt makes impossible —
// there is no single digest to index on. bcrypt's slow, salted hashing
// exists to blunt brute-forcing a low-entropy secret (a password); it buys
// nothing here since the token itself already has 256 bits of entropy.
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
