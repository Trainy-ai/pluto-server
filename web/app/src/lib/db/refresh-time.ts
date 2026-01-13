import Dexie from "dexie";

interface RefreshTimeEntry {
  id: string;
  lastRefreshed: Date;
}

class RefreshTimeDB extends Dexie {
  refreshTimes!: Dexie.Table<RefreshTimeEntry, string>;
  private _isAvailable: boolean = true;
  private _initPromise: Promise<boolean>;

  constructor() {
    super("refreshTimes");
    this.version(1).stores({
      refreshTimes: "id",
    });

    // Test if IndexedDB is actually available
    this._initPromise = this.open()
      .then(() => {
        this._isAvailable = true;
        return true;
      })
      .catch((err) => {
        console.warn(
          "IndexedDB not available for refreshTimes, falling back to no-op mode:",
          err.message,
        );
        this._isAvailable = false;
        return false;
      });
  }

  async getLastRefreshTime(id: string): Promise<Date | null> {
    // Wait for init to complete before checking availability
    if (!(await this._initPromise)) return null;
    if (!this._isAvailable) return null;

    try {
      const entry = await this.refreshTimes.get(id);
      return entry?.lastRefreshed || null;
    } catch (error) {
      console.warn("Error getting refresh time:", error);
      this._isAvailable = false;
      return null;
    }
  }

  async setLastRefreshTime(id: string, date: Date): Promise<void> {
    // Wait for init to complete before checking availability
    if (!(await this._initPromise)) return;
    if (!this._isAvailable) return;

    try {
      await this.refreshTimes.put({
        id,
        lastRefreshed: date,
      });
    } catch (error) {
      console.warn("Error setting refresh time:", error);
      this._isAvailable = false;
    }
  }

  async cleanupOldRefreshTimes(olderThan: Date): Promise<void> {
    // Wait for init to complete before checking availability
    if (!(await this._initPromise)) return;
    if (!this._isAvailable) return;

    try {
      await this.refreshTimes.where("lastRefreshed").below(olderThan).delete();
    } catch (error) {
      console.warn("Error cleaning up old refresh times:", error);
      this._isAvailable = false;
    }
  }
}

const db = new RefreshTimeDB();

export const getLastRefreshTime = (id: string): Promise<Date | null> => {
  return db.getLastRefreshTime(id);
};

export const setLastRefreshTime = (id: string, date: Date): Promise<void> => {
  return db.setLastRefreshTime(id, date);
};

export const cleanupOldRefreshTimes = (olderThan: Date): Promise<void> => {
  return db.cleanupOldRefreshTimes(olderThan);
};
