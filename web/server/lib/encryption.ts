import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for encryption");
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:ciphertext:authTag
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Expects base64-encoded format: iv:ciphertext:authTag
 */
export function decrypt(encryptedString: string): string {
  const key = getKey();
  const parts = encryptedString.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
