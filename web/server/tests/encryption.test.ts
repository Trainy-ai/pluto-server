/**
 * Encryption Utility Tests
 *
 * Tests the AES-256-GCM encrypt/decrypt functions.
 * Run with: cd web && pnpm --filter @mlop/server test:unit
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Set the env var before importing encryption module
const TEST_SECRET = "test-secret-for-encryption-tests-minimum-length";

describe("Encryption Utility", () => {
  let encrypt: (plaintext: string) => string;
  let decrypt: (encryptedString: string) => string;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    const mod = await import("../lib/encryption");
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  afterAll(() => {
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("should encrypt and decrypt a simple string", () => {
    const plaintext = "lin_api_test_key_12345";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for the same input (random IV)", () => {
    const plaintext = "same-input";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it("should handle empty strings", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("should handle long strings", () => {
    const plaintext = "a".repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should handle unicode characters", () => {
    const plaintext = "Hello, World! Unicode test: emoji support";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce base64 format with 3 parts separated by colons", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);

    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encrypt("sensitive-data");
    const parts = encrypted.split(":");
    // Tamper with the ciphertext
    const tamperedCiphertext = Buffer.from(parts[1], "base64");
    tamperedCiphertext[0] ^= 0xff;
    parts[1] = tamperedCiphertext.toString("base64");
    const tampered = parts.join(":");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("should throw on invalid format", () => {
    expect(() => decrypt("not-valid-format")).toThrow("Invalid encrypted string format");
    expect(() => decrypt("part1:part2")).toThrow("Invalid encrypted string format");
  });
});
