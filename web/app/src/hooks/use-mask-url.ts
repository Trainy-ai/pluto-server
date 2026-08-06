/**
 * Resolving a segmentation mask's `fileName` to a presigned URL.
 *
 * Three viewers need this — the run page's image grid, the all-runs comparison
 * grid and the Files tab — and each had hand-rolled it slightly differently.
 * Beyond the duplication, the hand-rolled versions were inline arrow functions,
 * which is a real performance bug rather than a style complaint: `AnnotatedImage`
 * takes the resolver as a prop and its mask-recolouring effect depends on it, so
 * a fresh identity on every parent render re-ran the whole load / getImageData /
 * per-pixel / putImageData pipeline and made the masks visibly blink. These
 * hooks hand back a resolver whose identity is stable for as long as the file
 * list is, and swap the per-lookup `Array.find` for a `Map`.
 */

import { useMemo } from "react";
import { isMaskFile } from "@/lib/file-types";

/** Resolves a mask's fileName to a URL, or undefined when it is not available. */
export type MaskUrlResolver = (fileName: string) => string | undefined;

/** The shape every file query returns; only these fields are needed here. */
export interface MaskCandidateFile {
  fileName: string;
  url?: string | null;
  fileType?: string | null;
}

/** A file that also knows which run it came from, for the all-runs grid. */
export interface RunScopedFile extends MaskCandidateFile {
  runId: string;
}

/**
 * Masks are not pictures — their pixel values are class ids, so rendered raw
 * they are near-black tiles. They must stay in the query result (presigned URLs
 * are signed per object key, so one cannot be derived from another file's URL)
 * but must never appear in a grid or file tree of their own.
 */
export function excludeMaskFiles<T extends { fileType?: string | null }>(
  files: T[] | undefined,
): T[] {
  return (files ?? []).filter((file) => !isMaskFile(file.fileType));
}

const NO_URL: MaskUrlResolver = () => undefined;

/** Resolver over one run's files. */
export function useMaskUrl(files: MaskCandidateFile[] | undefined): MaskUrlResolver {
  return useMemo(() => {
    if (!files || files.length === 0) {
      return NO_URL;
    }
    const byName = new Map<string, string>();
    for (const file of files) {
      if (file.url) {
        byName.set(file.fileName, file.url);
      }
    }
    return (fileName: string) => byName.get(fileName);
  }, [files]);
}

/**
 * Resolver factory for the all-runs grid, where one flat list spans every
 * selected run.
 *
 * Scoping by run is load-bearing, not defensive: the wandb migration gives the
 * same mask filename to every run exported together, so a name-only match lets
 * another run's mask win. The per-run resolvers are cached so that repeated
 * calls for the same run — one per card, on every render — keep returning the
 * same function, which is the whole point of the hook.
 */
export function useMaskUrlByRun(
  files: RunScopedFile[] | undefined,
): (runId: string) => MaskUrlResolver {
  return useMemo(() => {
    // Nested rather than a composite string key: no separator to pick, and no
    // way for an exotic filename to collide across runs.
    const byRun = new Map<string, Map<string, string>>();
    for (const file of files ?? []) {
      if (!file.url) {
        continue;
      }
      let forRun = byRun.get(file.runId);
      if (!forRun) {
        forRun = new Map<string, string>();
        byRun.set(file.runId, forRun);
      }
      forRun.set(file.fileName, file.url);
    }
    const cache = new Map<string, MaskUrlResolver>();
    return (runId: string) => {
      let resolver = cache.get(runId);
      if (!resolver) {
        const forRun = byRun.get(runId);
        resolver = forRun ? (fileName: string) => forRun.get(fileName) : NO_URL;
        cache.set(runId, resolver);
      }
      return resolver;
    };
  }, [files]);
}

/**
 * Resolver over an explicit name → URL mapping.
 *
 * The Files tab is the odd one out: it browses file *metadata* and fetches
 * presigned URLs on demand, so it has no file list carrying URLs to build a
 * resolver from.
 */
export function useMaskUrlFromEntries(
  entries: [string, string | undefined][],
): MaskUrlResolver {
  // Keyed on the contents rather than the array identity: callers rebuild this
  // array whenever their queries re-render, and an identity dep would defeat
  // the memo that exists to keep the resolver stable.
  const key = JSON.stringify(entries);
  return useMemo(() => {
    const resolved: [string, string | undefined][] = JSON.parse(key);
    const byName = new Map<string, string>();
    for (const [name, url] of resolved) {
      if (url) {
        byName.set(name, url);
      }
    }
    return (fileName: string) => byName.get(fileName);
  }, [key]);
}
