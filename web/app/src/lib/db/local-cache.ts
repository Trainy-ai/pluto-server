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
  store: EntityTable<CacheData<T>, string>;
  maxSize: number;
  constructor(dbName: string, storeName: string, maxSize: number, version = 1) {
    super(dbName);
    this.version(version).stores({
      [storeName]: "id, syncedAt, finishedAt",
    });
    // Explicitly set the table type.
    this.store = this.table<CacheData<T>, string>(storeName);
    this.maxSize = maxSize;
  }

  async checkAndClearIfNeeded() {
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
    return this.store.get(id);
  }

  async setData(
    id: string,
    data: T,
    finishedAt: Date | null = null,
  ): Promise<void> {
    const record: CacheData<T> = {
      id,
      syncedAt: new Date(),
      data,
      finishedAt,
    };

    await this.store.put(record as CacheData<T>);
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

export function useLocalStorage<T>(
  db: LocalCache<T>,
  key: string,
  defaultValue: T,
): [T, (value: T, finishedAt?: Date | null) => Promise<void>] {
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

  const setLocalStorage = useCallback(
    async (newValue: T, finishedAt: Date | null = null) => {
      try {
        await db.setData(key, newValue, finishedAt);
      } catch (err) {
        console.error("Error writing to LocalCache:", err);
      }
    },
    [db, key],
  );

  return [value, setLocalStorage];
}
