import Dexie, { liveQuery, type EntityTable } from "dexie";
import { useEffect, useState, useCallback } from "react";

export interface CacheData<T> {
  id: string;
  syncedAt: Date;
  data: T;
  finishedAt: Date | null;
  // Allow Dexie to attach extra properties if needed.
  [key: string]: any;
}

export class LocalCache<T> extends Dexie {
  store!: EntityTable<CacheData<T>, string>;
  maxSize: number;
  private _isAvailable: boolean = true;
  private _initPromise: Promise<boolean>;

  constructor(dbName: string, storeName: string, maxSize: number, version = 1) {
    super(dbName);
    this.maxSize = maxSize;

    // Initialize the database schema
    this.version(version).stores({
      [storeName]: "id, syncedAt, finishedAt",
    });
    this.store = this.table<CacheData<T>, string>(storeName);

    // Test if IndexedDB is actually available by attempting to open
    this._initPromise = this.open()
      .then(() => {
        this._isAvailable = true;
        return true;
      })
      .catch((err) => {
        console.warn(
          `IndexedDB not available for ${dbName}, falling back to memory-only mode:`,
          err.message,
        );
        this._isAvailable = false;
        return false;
      });
  }

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  async waitForInit(): Promise<boolean> {
    return this._initPromise;
  }

  async checkAndClearIfNeeded() {
    await this._initPromise;
    if (!this._isAvailable) return;
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage && estimate.usage > this.maxSize) {
        await this.delete();
        console.log("IndexedDB cleared due to size limit exceeded");
      }
    } catch (error) {
      console.error("Error checking storage size:", error);
    }
  }

  async getData(id: string): Promise<CacheData<T> | undefined> {
    await this._initPromise;
    if (!this._isAvailable) return undefined;
    try {
      return await this.store.get(id);
    } catch (error) {
      // If we get a DatabaseClosedError or similar, mark as unavailable
      console.warn("IndexedDB read failed, disabling cache:", error);
      this._isAvailable = false;
      return undefined;
    }
  }

  async setData(
    id: string,
    data: T,
    finishedAt: Date | null = null,
  ): Promise<void> {
    await this._initPromise;
    if (!this._isAvailable) return;
    try {
      const record: CacheData<T> = {
        id,
        syncedAt: new Date(),
        data,
        finishedAt,
      };
      await this.store.put(record as CacheData<T>);
    } catch (error) {
      // If we get a DatabaseClosedError or similar, mark as unavailable
      console.warn("IndexedDB write failed, disabling cache:", error);
      this._isAvailable = false;
    }
  }
}

export const useCheckDatabaseSize = (db: LocalCache<any>) => {
  useEffect(() => {
    const checkSize = async () => {
      try {
        await db.checkAndClearIfNeeded();
      } catch (error) {
        console.error("Error checking database size:", error);
      }
    };
    checkSize();
  }, [db]);
};

export type LocalStorageUpdater<T> = T | ((prev: T) => T);

export function useLocalStorage<T>(
  db: LocalCache<T>,
  key: string,
  defaultValue: T,
): [T, (value: LocalStorageUpdater<T>, finishedAt?: Date | null) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    // Subscribe to liveQuery of this key
    const sub = liveQuery(() => db.getData(key)).subscribe({
      next: (record: CacheData<T> | undefined) => {
        if (record && record.data !== undefined) {
          setValue(record.data);
        } else {
          // no record yet → use default
          setValue(defaultValue);
        }
      },
      error: (err) => {
        console.error("liveQuery error in useLocalStorage:", err);
      },
    });

    return () => {
      sub.unsubscribe();
    };
  }, [db, key, defaultValue]);

  // Functional-updater support is REQUIRED, not optional. React state starts
  // at `defaultValue` and is replaced asynchronously by liveQuery — there is
  // a ~100-300ms window where the React-state value disagrees with the
  // persisted IndexedDB value. Any caller that does
  //   setValue({ ...value, foo: 1 })   // ← spreads stale closure
  // during that window will write back the defaults for every OTHER key,
  // clobbering the user's saved preferences. Callers must use the
  // functional form for merges:
  //   setValue(prev => ({ ...prev, foo: 1 }))
  // The updater receives the freshest persisted value (read directly from
  // IndexedDB at call time), not the stale closure.
  const setLocalStorage = useCallback(
    async (
      newValueOrUpdater: LocalStorageUpdater<T>,
      finishedAt: Date | null = null,
    ) => {
      try {
        let newValue: T;
        if (typeof newValueOrUpdater === "function") {
          const record = await db.getData(key);
          const current =
            record && record.data !== undefined ? record.data : defaultValue;
          newValue = (newValueOrUpdater as (prev: T) => T)(current);
        } else {
          newValue = newValueOrUpdater;
        }
        await db.setData(key, newValue, finishedAt);
      } catch (err) {
        console.error("Error writing to LocalCache:", err);
      }
    },
    [db, key, defaultValue],
  );

  return [value, setLocalStorage];
}
