import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalCache } from "../local-cache";

describe("LocalCache", () => {
  describe("when IndexedDB is available", () => {
    it("stores and retrieves data successfully", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-available",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();

      expect(cache.isAvailable).toBe(true);

      await cache.setData("test-key", { value: "hello" });
      const result = await cache.getData("test-key");

      expect(result).toBeDefined();
      expect(result?.data.value).toBe("hello");
      expect(result?.syncedAt).toBeInstanceOf(Date);
    });

    it("returns undefined for non-existent keys", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-nonexistent",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();

      const result = await cache.getData("nonexistent-key");
      expect(result).toBeUndefined();
    });

    it("stores finishedAt when provided", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-finished",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();

      const finishedAt = new Date();
      await cache.setData("test-key", { value: "done" }, finishedAt);
      const result = await cache.getData("test-key");

      expect(result?.finishedAt).toEqual(finishedAt);
    });
  });

  describe("when IndexedDB operations fail at runtime", () => {
    it("handles getData errors gracefully and marks cache unavailable", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-runtime-error",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();
      expect(cache.isAvailable).toBe(true);

      // Store some data first
      await cache.setData("test-key", { value: "original" });

      // Now simulate a runtime error by making the store.get throw
      const originalGet = cache.store.get.bind(cache.store);
      cache.store.get = vi.fn().mockRejectedValue(new Error("Runtime DB error"));

      // getData should return undefined and mark cache as unavailable
      const result = await cache.getData("test-key");
      expect(result).toBeUndefined();
      expect(cache.isAvailable).toBe(false);

      // Subsequent getData calls should return undefined without throwing
      const result2 = await cache.getData("test-key");
      expect(result2).toBeUndefined();

      // Restore for cleanup
      cache.store.get = originalGet;
    });

    it("handles setData errors gracefully and marks cache unavailable", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-setdata-error",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();
      expect(cache.isAvailable).toBe(true);

      // Simulate a runtime error by making the store.put throw
      const originalPut = cache.store.put.bind(cache.store);
      cache.store.put = vi.fn().mockRejectedValue(new Error("Write error"));

      // setData should not throw and should mark cache as unavailable
      await expect(
        cache.setData("test-key", { value: "test" }),
      ).resolves.not.toThrow();
      expect(cache.isAvailable).toBe(false);

      // Subsequent setData calls should be no-ops
      await expect(
        cache.setData("another-key", { value: "test2" }),
      ).resolves.not.toThrow();

      // Restore for cleanup
      cache.store.put = originalPut;
    });

    it("skips operations when isAvailable is false", async () => {
      const cache = new LocalCache<{ value: string }>(
        "test-skip-ops",
        "store",
        1024 * 1024,
      );
      await cache.waitForInit();

      // Manually set to unavailable (simulating prior failure)
      (cache as any)._isAvailable = false;

      // Spy on store methods to ensure they're not called
      const getSpy = vi.spyOn(cache.store, "get");
      const putSpy = vi.spyOn(cache.store, "put");

      await cache.getData("test-key");
      await cache.setData("test-key", { value: "test" });

      expect(getSpy).not.toHaveBeenCalled();
      expect(putSpy).not.toHaveBeenCalled();
    });
  });
});
