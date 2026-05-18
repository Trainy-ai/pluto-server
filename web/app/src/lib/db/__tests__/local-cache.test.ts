import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { LocalCache, useLocalStorage } from "../local-cache";

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

describe("useLocalStorage — functional updater race-safety", () => {
  type Settings = { a: boolean; b: boolean; nested: { x: number; y: number } };
  const DEFAULTS: Settings = {
    a: true,
    b: true,
    nested: { x: 0, y: 0 },
  };

  it("functional updater merges against the freshest persisted value, not the stale React-state default", async () => {
    // Simulates the exact race that was clobbering user settings on
    // pluto.trainy.ai: IndexedDB has a saved record, but the hook's
    // React state still equals DEFAULTS for ~150ms after mount. A write
    // that fires inside that window MUST merge against the persisted
    // value, not the stale closure.
    const cache = new LocalCache<Settings>(
      "test-race-functional",
      "settings",
      1024 * 1024,
    );
    await cache.waitForInit();
    // Pre-populate IndexedDB with the user's saved preferences
    await cache.setData("k", { a: false, b: false, nested: { x: 5, y: 7 } });

    const { result } = renderHook(() => useLocalStorage(cache, "k", DEFAULTS));

    // First render: React state is DEFAULTS (the stale-window scenario).
    // Fire the write IMMEDIATELY, before liveQuery has had a chance to
    // resolve — exactly mimicking a useEffect that runs on mount.
    await act(async () => {
      // Functional form — should read freshest from IndexedDB
      await result.current[1]((prev) => ({ ...prev, nested: { ...prev.nested, x: 99 } }));
    });

    // Read back from IndexedDB directly. Both `a: false` and `b: false`
    // (the user's saved preferences) must be preserved. `nested.y: 7` must
    // also be preserved. Only `nested.x` should have changed.
    const persisted = await cache.getData("k");
    expect(persisted?.data).toEqual({
      a: false,
      b: false,
      nested: { x: 99, y: 7 },
    });
  });

  it("value form (non-functional) still writes the value as-is", async () => {
    const cache = new LocalCache<Settings>(
      "test-race-value",
      "settings",
      1024 * 1024,
    );
    await cache.waitForInit();
    await cache.setData("k", { a: false, b: false, nested: { x: 1, y: 2 } });

    const { result } = renderHook(() => useLocalStorage(cache, "k", DEFAULTS));

    await act(async () => {
      // Value form bypasses the merge — caller is taking full responsibility
      await result.current[1]({ a: true, b: true, nested: { x: 9, y: 9 } });
    });

    const persisted = await cache.getData("k");
    expect(persisted?.data).toEqual({ a: true, b: true, nested: { x: 9, y: 9 } });
  });

  it("functional updater falls back to defaultValue when no record exists yet", async () => {
    // First-visit scenario — IndexedDB is empty, so the updater receives
    // the configured defaultValue rather than `undefined`.
    const cache = new LocalCache<Settings>(
      "test-race-fresh",
      "settings",
      1024 * 1024,
    );
    await cache.waitForInit();

    const { result } = renderHook(() => useLocalStorage(cache, "k", DEFAULTS));

    await act(async () => {
      await result.current[1]((prev) => ({ ...prev, a: false }));
    });

    const persisted = await cache.getData("k");
    expect(persisted?.data).toEqual({
      a: false,
      b: true,
      nested: { x: 0, y: 0 },
    });
  });

  it("React state catches up to persisted value after liveQuery resolves", async () => {
    const cache = new LocalCache<Settings>(
      "test-race-livequery",
      "settings",
      1024 * 1024,
    );
    await cache.waitForInit();
    await cache.setData("k", { a: false, b: false, nested: { x: 5, y: 7 } });

    const { result } = renderHook(() => useLocalStorage(cache, "k", DEFAULTS));

    // React state starts at DEFAULTS, liveQuery resolves async
    await waitFor(() => {
      expect(result.current[0]).toEqual({
        a: false,
        b: false,
        nested: { x: 5, y: 7 },
      });
    });
  });
});
