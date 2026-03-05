import Fuse, { type IFuseOptions } from "fuse.js";

const FUSE_OPTIONS: IFuseOptions<string> = {
  // 0.0 = perfect match only, 1.0 = match anything.
  // Lowered from 0.4 to 0.35 to reduce false positives (e.g. "loss" matching "learning_rate")
  // while still allowing minor typos.
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 1,
};

/**
 * Returns fuzzy-matched items sorted by relevance.
 * Empty query returns all items unchanged.
 */
export function fuzzyFilter(items: string[], query: string): string[] {
  if (!query.trim()) return items;

  const fuse = new Fuse(items, FUSE_OPTIONS);
  return fuse.search(query).map((r) => r.item);
}

