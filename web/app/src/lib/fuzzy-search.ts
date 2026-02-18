import Fuse, { type IFuseOptions } from "fuse.js";

const FUSE_OPTIONS: IFuseOptions<string> = {
  threshold: 0.4,
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

