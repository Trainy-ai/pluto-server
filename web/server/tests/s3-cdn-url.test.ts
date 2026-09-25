/**
 * Unit tests for CloudFront signed download URLs in getS3Url.
 *
 * When STORAGE_CDN_URL / CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY are
 * all set, download URLs are CloudFront signed URLs (canned policy) instead of
 * S3 presigned URLs. These tests sign with a throwaway RSA key and verify the
 * signature the way CloudFront does, so a broken URL shape or encoding fails
 * here rather than as 403s in the browser.
 *
 * Run with: pnpm --filter @mlop/server test:smoke
 */
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Redis as unavailable (the memo will use L1 only).
vi.mock("../lib/redis", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  isRedisAvailable: vi.fn().mockReturnValue(false),
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const baseEnv = {
  STORAGE_REGION: "us-east-1",
  STORAGE_ENDPOINT: "http://minio:9000",
  STORAGE_ACCESS_KEY_ID: "test-access",
  STORAGE_SECRET_ACCESS_KEY: "test-secret",
  STORAGE_BUCKET: "test-bucket",
};

const cdnEnv = {
  STORAGE_CDN_URL: "https://pluto-media.example/",
  CLOUDFRONT_KEY_PAIR_ID: "K2TESTKEYPAIR",
  CLOUDFRONT_PRIVATE_KEY: privateKey,
};

// s3.ts reads env at import time, so each scenario re-imports it fresh.
async function loadS3(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("../lib/env", () => ({ env }));
  const s3 = await import("../lib/s3");
  const { clearL1Cache } = await import("../lib/cache");
  clearL1Cache();
  return s3;
}

// Verifies a CloudFront canned-policy signed URL against the public key.
function verifyCannedSignature(signedUrl: string): boolean {
  const url = new URL(signedUrl);
  const expires = url.searchParams.get("Expires");
  const signature = url.searchParams.get("Signature")!;
  const resource = `${url.origin}${url.pathname}`;
  const policy = `{"Statement":[{"Resource":"${resource}","Condition":{"DateLessThan":{"AWS:EpochTime":${expires}}}}]}`;
  // CloudFront's URL-safe base64: '+' -> '-', '=' -> '_', '/' -> '~'.
  const sig = Buffer.from(
    signature.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"),
    "base64"
  );
  return verify("RSA-SHA1", Buffer.from(policy), publicKey, sig);
}

describe("getS3Url with CloudFront configured", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a verifiable CloudFront signed URL valid for ~5 days", async () => {
    const { getImageUrl } = await loadS3({ ...baseEnv, ...cdnEnv });
    const before = Math.floor(Date.now() / 1000);

    const signed = await getImageUrl("tenant", "proj", 1, "log", "file.png");
    const url = new URL(signed);

    // Trailing slash on STORAGE_CDN_URL must not produce a double slash.
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://pluto-media.example/tenant/proj/1/log/file.png"
    );
    expect(url.searchParams.get("Key-Pair-Id")).toBe("K2TESTKEYPAIR");
    const expires = Number(url.searchParams.get("Expires"));
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 24 * 3600 - 5);
    expect(expires).toBeLessThanOrEqual(before + 5 * 24 * 3600 + 5);
    expect(verifyCannedSignature(signed)).toBe(true);
    // Guard against a vacuous verifier: a tampered path must not verify.
    expect(verifyCannedSignature(signed.replace("file.png", "other.png"))).toBe(
      false
    );
  });

  it("percent-encodes each key segment but keeps '/' separators", async () => {
    const { getImageUrl } = await loadS3({ ...baseEnv, ...cdnEnv });

    const signed = await getImageUrl(
      "tenant",
      "my proj",
      1,
      "log",
      "a+b #1 ünï?.png"
    );
    const url = new URL(signed);

    expect(url.pathname).toBe(
      "/tenant/my%20proj/1/log/a%2Bb%20%231%20%C3%BCn%C3%AF%3F.png"
    );
    expect(verifyCannedSignature(signed)).toBe(true);
  });

  it("accepts a PEM whose newlines arrive as literal \\n", async () => {
    const { getImageUrl } = await loadS3({
      ...baseEnv,
      ...cdnEnv,
      CLOUDFRONT_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
    });

    const signed = await getImageUrl("tenant", "proj", 1, "log", "file.png");
    expect(verifyCannedSignature(signed)).toBe(true);
  });

  it("memoizes: repeated calls return the identical URL", async () => {
    const { getImageUrl } = await loadS3({ ...baseEnv, ...cdnEnv });

    const url1 = await getImageUrl("tenant", "proj", 1, "log", "same.png");
    const url2 = await getImageUrl("tenant", "proj", 1, "log", "same.png");
    expect(url1).toBe(url2);
  });

  it("fails at import when the CloudFront config is incomplete", async () => {
    await expect(
      loadS3({ ...baseEnv, STORAGE_CDN_URL: cdnEnv.STORAGE_CDN_URL })
    ).rejects.toThrow(
      /Incomplete CloudFront config.*CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY/
    );
  });
});

describe("getS3Url without CloudFront", () => {
  it("falls back to an S3 presigned URL on the storage endpoint", async () => {
    const { getImageUrl } = await loadS3(baseEnv);

    const signed = await getImageUrl("tenant", "proj", 1, "log", "file.png");
    const url = new URL(signed);

    expect(url.origin).toBe("http://minio:9000");
    expect(url.pathname).toBe("/test-bucket/tenant/proj/1/log/file.png");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.has("Key-Pair-Id")).toBe(false);
  });
});
