import Dexie from "dexie";

interface RefreshTimeEntry {
  id: string;
  lastRefreshed: Date;
}

class RefreshTimeDB extends Dexie {
  refreshTimes!: Dexie.Table<RefreshTimeEntry, string>;

  constructor() {
    super("refreshTimes");
    this.version(1).stores({
      refreshTimes: "id",
    });
  }
}

const db = new RefreshTimeDB();

export const getLastRefreshTime = async (id: string): Promise<Date | null> => {
  try {
    const entry = await db.refreshTimes.get(id);
    return entry?.lastRefreshed || null;
  } catch (error) {
    console.error("Error getting refresh time:", error);
    return null;
  }
};

export const setLastRefreshTime = async (
  id: string,
  date: Date,
): Promise<void> => {
  try {
    await db.refreshTimes.put({
      id,
      lastRefreshed: date,
    });
  } catch (error) {
    console.error("Error setting refresh time:", error);
  }
};

// Optional: Clean up old entries periodically
export const cleanupOldRefreshTimes = async (
  olderThan: Date,
): Promise<void> => {
  try {
    await db.refreshTimes.where("lastRefreshed").below(olderThan).delete();
  } catch (error) {
    console.error("Error cleaning up old refresh times:", error);
  }
};
