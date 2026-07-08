import { COLORS_KELLY_DARK } from "@/components/ui/color-picker";

/** Stable color for a bucket trail. Same trail → same color across
 *  reloads / page navigations, mirroring W&B's grouped-table palette
 *  behaviour where each group gets one assigned color that flows
 *  through to charts and runs in the bucket.
 *
 *  Hash: FNV-1a over the trail's UTF-8 bytes. Decent distribution for
 *  short ASCII inputs and deterministic without depending on platform
 *  string hashing. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime — bit-shift unsigned mul to stay in i32.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

const PALETTE = COLORS_KELLY_DARK;

/** Pick a color for a bucket whose trail serializes to `pathKey`.
 *  Pure function; same input → same output. */
export function bucketColorFor(pathKey: string): string {
  return PALETTE[fnv1a(pathKey) % PALETTE.length];
}
