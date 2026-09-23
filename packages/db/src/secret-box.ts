import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for the few values that must be stored but never read
 * back by anyone except this service: a Slack or Discord webhook URL, a
 * Telegram bot token.
 *
 * These are not user credentials. Stackkeeper stores no passwords, SSH keys
 * or provider tokens at all. What this protects is the handful of values that
 * authenticate the service to somewhere else, so that a stolen database dump
 * on its own cannot post into a customer's Slack.
 *
 * AES-256-GCM from the standard library, with a random nonce per message and
 * the key identified by a short fingerprint so keys can be rotated without
 * guessing which one encrypted what.
 *
 * Format: version(1) | keyId(4) | nonce(12) | ciphertext | tag(16)
 */

const VERSION = 1;
const KEY_ID_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {}

/** A 32-byte key derived from the configured secret. */
function deriveKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new SecretBoxError(
      "The encryption secret must be at least 32 characters. Generate one with: openssl rand -base64 32",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function keyId(key: Buffer): Buffer {
  return createHash("sha256").update(key).digest().subarray(0, KEY_ID_BYTES);
}

export interface SecretBox {
  seal(plaintext: string): Buffer;
  open(sealed: Buffer): string;
  /** True when this box holds the key that sealed the value. */
  canOpen(sealed: Buffer): boolean;
}

export function createSecretBox(secret: string): SecretBox {
  const key = deriveKey(secret);
  const id = keyId(key);

  return {
    seal(plaintext: string): Buffer {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([Buffer.from([VERSION]), id, nonce, ciphertext, cipher.getAuthTag()]);
    },

    canOpen(sealed: Buffer): boolean {
      if (sealed.length < 1 + KEY_ID_BYTES) return false;
      const theirs = sealed.subarray(1, 1 + KEY_ID_BYTES);
      return theirs.length === id.length && timingSafeEqual(theirs, id);
    },

    open(sealed: Buffer): string {
      if (sealed.length < 1 + KEY_ID_BYTES + NONCE_BYTES + TAG_BYTES) {
        throw new SecretBoxError("That value is too short to be a sealed secret");
      }
      if (sealed[0] !== VERSION) {
        throw new SecretBoxError(`Unknown sealed secret version ${sealed[0]}`);
      }
      if (!this.canOpen(sealed)) {
        throw new SecretBoxError(
          "That value was sealed with a different key. Check STACKKEEPER_SECRET_KEY.",
        );
      }

      const nonceStart = 1 + KEY_ID_BYTES;
      const nonce = sealed.subarray(nonceStart, nonceStart + NONCE_BYTES);
      const tag = sealed.subarray(sealed.length - TAG_BYTES);
      const ciphertext = sealed.subarray(nonceStart + NONCE_BYTES, sealed.length - TAG_BYTES);

      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        // GCM failing means the bytes were altered, which is worth saying
        // plainly rather than reporting as a generic decryption error.
        throw new SecretBoxError("That sealed secret has been tampered with or is corrupt");
      }
    },
  };
}

let cached: SecretBox | null = null;

/** The process-wide box, from STACKKEEPER_SECRET_KEY. */
export function secretBox(): SecretBox {
  if (cached) return cached;
  const secret = process.env.STACKKEEPER_SECRET_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new SecretBoxError(
      "STACKKEEPER_SECRET_KEY is not set, so webhook secrets cannot be stored.",
    );
  }
  cached = createSecretBox(secret);
  return cached;
}

/** For tests. */
export function resetSecretBox(): void {
  cached = null;
}
