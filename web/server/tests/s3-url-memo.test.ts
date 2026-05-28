/**
 * Unit tests for getS3Url memoization.
 *
 * Background: every call to @aws-sdk/s3-request-presigner's getSignedUrl
 * stamps a fresh X-Amz-Date / X-Amz-Signature into the URL, so repeated calls
 * for the same object key produce different strings. That cache-busts the
 * browser HTTP cache on every refetch / carousel-click / auto-refresh.
 *
 * getS3Url wraps the presigner with a read-through memo (L1 LRU + optional L2
 * Redis) keyed on the storage endpoint, bucket, object key, and expiry. This
 * file exercises the memo behavior so the fix doesn't regress.
 *
 * Run with: pnpm --filter @mlop/server test:smoke
 *           (or pnpm test:cache — uses the same vitest config, no env needed)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock env module to avoid requiring real environment variables.
vi.mock("../lib/env", () => ({
  env: {
    STORAGE_REGION: "us-east-1",
    STORAGE_ENDPOINT: "http://minio:9000",
    STORAGE_ACCESS_KEY_ID: "test-access",
    STORAGE_SECRET_ACCESS_KEY: "test-secret",
    STORAGE_BUCKET: "test-bucket",
  },
}));

// Mock Redis as unavailable (the memo will use L1 only).
vi.mock("../lib/redis", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  isRedisAvailable: vi.fn().mockReturnValue(false),
}));

// Mock the AWS presigner so each call returns a unique URL (matches real
// SigV4 behavior — fresh X-Amz-Date / X-Amz-Signature every call). If the
// memo works, our code calls this at most once per (endpoint, bucket, key,
// expiresIn) within the TTL window.
let presignCallCount = 0;
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client, command: { input: { Key: string } }) => {
    presignCallCount++;
    return `https://example.com/${command.input.Key}?sig=${presignCallCount}`;
  }),
}));

// Imported after the mocks so the module picks up the mocked env / presigner.
const { getImageUrl } = await import("../lib/s3");
const { clearL1Cache } = await import("../lib/cache");
const { getRedisClient } = await import("../lib/redis");

describe("getS3Url memoization", () => {
  beforeEach(() => {
    clearL1Cache();
    presignCallCount = 0;
  });

  it("returns the same URL string for repeated calls with the same key", async () => {
    const url1 = await getImageUrl("tenant", "proj", 1, "log", "file.png");
    const url2 = await getImageUrl("tenant", "proj", 1, "log", "file.png");

    expect(url1).toBe(url2);
    // The underlying presigner should only have been called once.
    expect(presignCallCount).toBe(1);
  });

  it("returns different URLs for different object keys", async () => {
    const url1 = await getImageUrl("tenant", "proj", 1, "log", "a.png");
    const url2 = await getImageUrl("tenant", "proj", 1, "log", "b.png");

    expect(url1).not.toBe(url2);
    expect(presignCallCount).toBe(2);
  });

  it("returns the URL even if the cache write fails (no misattribution)", async () => {
    // Regression for bugbot finding on PR #481: if setCached rejects (e.g. a
    // transient Redis client failure) while sitting inside the try/catch that
    // wraps getSignedUrl, the already-valid URL is discarded and the catch
    // throws a misleading "Failed to generate R2 image URL". The fix
    // fire-and-forgets the cache write so a memo-layer failure cannot mask
    // a successful sign.
    // getRedisClient is awaited twice: once by getCached (read miss) and once
    // by setCached (write). The first call resolves(null) to let the read
    // produce a cache miss naturally; the second rejects to simulate the
    // exact failure mode bugbot flagged on the write path.
    vi.mocked(getRedisClient)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("redis client unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const url = await getImageUrl("tenant", "proj", 1, "log", "flaky.png");
    // The presigner succeeded, so we get a real URL — not a thrown error.
    expect(url).toMatch(/^https:\/\/example\.com\/.+\?sig=\d+$/);

    // Drain microtasks so the fire-and-forget .catch() runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("only signs once across many sequential calls for the same key", async () => {
    // Sequential (await each) — once the first call writes to L1, every
    // following reader is a cache hit. This mirrors the realistic case: one
    // initial request warms the cache, repeat fetches (carousel click,
    // auto-refresh, sibling re-render) all hit it.
    const urls: string[] = [];
    for (let i = 0; i < 20; i++) {
      urls.push(await getImageUrl("tenant", "proj", 1, "log", "same.png"));
    }

    expect(new Set(urls).size).toBe(1);
    expect(presignCallCount).toBe(1);
  });
});
