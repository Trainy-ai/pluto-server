/**
 * Bounding boxes and segmentation masks drawn over an image.
 *
 * The shape is wandb's, deliberately: the migration forwards their JSON
 * untouched, and native `pluto.Image(boxes=..., masks=...)` adopts the same
 * thing, so there is one format to render and no translation layer to get
 * wrong. Everything is optional and unrecognised values are ignored rather
 * than throwing — an annotation that cannot be parsed must never take the
 * image down with it.
 *
 * Both boxes and masks are keyed by a *layer name* (`predictions`,
 * `ground_truth`, …). That is the point of the feature: you put the model's
 * guess and the correct answer on the same picture and flip between them.
 */

/** Where a box sits. Interpreted per `domain` — see `resolveBox`. */
export interface BoxPosition {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AnnotationBox {
  position: BoxPosition;
  /**
   * `"pixel"` means the numbers are pixels. Anything else (including absent)
   * means fractions of the image's width/height, which is wandb's default and
   * the single easiest thing to get wrong — pixel values read as fractions
   * land far off-canvas and the box silently disappears.
   */
  domain?: string;
  class_id?: number;
  box_caption?: string;
  scores?: Record<string, number>;
}

export interface BoxLayer {
  box_data: AnnotationBox[];
  /** class id → display name, e.g. `{"1": "cat"}`. */
  class_labels?: Record<string, string>;
}

export interface MaskLayer {
  /**
   * File name of the mask PNG in the same log group, where each pixel's value
   * is a class id. Masks are not inlined — see the ingest commit for why.
   */
  fileName?: string;
  class_labels?: Record<string, string>;
}

export interface ImageAnnotations {
  boxes?: Record<string, BoxLayer>;
  masks?: Record<string, MaskLayer>;
}

/** Parse the stored blob. Returns null for absent or unparseable data. */
export function parseAnnotations(raw: string | null | undefined): ImageAnnotations | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ImageAnnotations;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const hasBoxes = parsed.boxes && Object.keys(parsed.boxes).length > 0;
    const hasMasks = parsed.masks && Object.keys(parsed.masks).length > 0;
    return hasBoxes || hasMasks ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Box position in pixels, whatever the source units.
 *
 * wandb defaults to fractional coordinates and only uses pixels when the box
 * says `domain: "pixel"`. Getting this backwards draws nothing and reports no
 * error, so it is worth being explicit about.
 */
export function resolveBox(
  box: AnnotationBox,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const { minX, minY, maxX, maxY } = box.position;
  const pixel = box.domain === "pixel";
  const sx = pixel ? 1 : imageWidth;
  const sy = pixel ? 1 : imageHeight;
  const x0 = Math.min(minX, maxX) * sx;
  const y0 = Math.min(minY, maxY) * sy;
  return {
    x: x0,
    y: y0,
    width: Math.abs(maxX - minX) * sx,
    height: Math.abs(maxY - minY) * sy,
  };
}

/**
 * Stable colour per class id — wandb's own palette, values and order included.
 *
 * Taken from their frontend bundle rather than guessed, so a migrated run looks
 * the same here as it did there:
 *
 *     COLORS16 = ["#F07FDD","#C2327A","#F0434F","#FAB796","#E57439","#FFB83D",
 *                 "#9BC750","#479A5F","#87CEBF","#229487","#5BC5DB","#538AE5",
 *                 "#865ED6","#DC4BDC","#AD6F50","#A1A9AD"]
 *     ROBIN16  = [11,2,7,12,0,4,8,13,5,10,9,3,6,14,1,15].map(i => COLORS16[i])
 *     segmentationMaskColor = id => colorNRGB(id, ROBIN16)
 *     colorNRGB = (index, palette) => palette[index % palette.length]
 *
 * The array below is ROBIN16 already resolved. Sixteen entries, not ten: the
 * previous palette collided class 1 with class 11, which is well inside the
 * range a real segmentation run uses.
 *
 * Deterministic rather than random so a class keeps its colour between the box
 * layer and the mask layer — comparing "predicted cat" against "actual cat"
 * only works if both are the same colour.
 */
const CLASS_COLOURS = [
  "#538AE5", "#F0434F", "#479A5F", "#865ED6",
  "#F07FDD", "#E57439", "#87CEBF", "#DC4BDC",
  "#FFB83D", "#5BC5DB", "#229487", "#FAB796",
  "#9BC750", "#AD6F50", "#C2327A", "#A1A9AD",
];

export function classColour(classId: number | undefined): string {
  if (classId == null) {
    return CLASS_COLOURS[0];
  }
  return CLASS_COLOURS[Math.abs(Math.trunc(classId)) % CLASS_COLOURS.length];
}

/**
 * The class ids a mask layer should tint, or null to tint none.
 *
 * wandb builds its colour map by mapping over `class_labels` and falls back to
 * `DEFAULT_CLASS_COLOR = [0,0,0,0]` — fully transparent — for any pixel whose
 * id is not in it. So the rule is membership in `class_labels`, and there is no
 * special case for id 0: an unlabelled background is left clear, and a class 0
 * that *is* labelled gets tinted like any other.
 *
 * Note the consequence, which is wandb's too: a mask logged without
 * `class_labels` renders nothing at all.
 */
export function labelledClassIds(
  labels: Record<string, string> | undefined,
): Set<number> {
  const ids = new Set<number>();
  for (const key of Object.keys(labels ?? {})) {
    const id = Number(key);
    if (Number.isInteger(id) && id >= 0) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Every class id a mask pixel can hold (an 8-bit channel, so 0-255) resolved to
 * flat RGB triples: `CLASS_RGB_LUT[id * 3 + {0,1,2}]`.
 *
 * Built once at module load because mask recolouring is per-pixel. Deriving the
 * colour inside that loop — hex slice, `parseInt`, a template literal, a regex
 * match and two intermediate arrays — cost roughly six short-lived allocations
 * per pixel, which on a 1024x1024 mask is several million allocations and a
 * multi-hundred-millisecond main-thread stall for a single redraw. A 768-byte
 * table removes all of it.
 */
export const CLASS_RGB_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let id = 0; id < 256; id++) {
    const n = parseInt(classColour(id).slice(1), 16);
    lut[id * 3] = (n >> 16) & 255;
    lut[id * 3 + 1] = (n >> 8) & 255;
    lut[id * 3 + 2] = n & 255;
  }
  return lut;
})();

/** Every layer name across boxes and masks, in a stable order. */
export function layerNames(annotations: ImageAnnotations): string[] {
  return [
    ...new Set([
      ...Object.keys(annotations.boxes ?? {}),
      ...Object.keys(annotations.masks ?? {}),
    ]),
  ].sort();
}

/** Display name for a class id, falling back to the raw id. */
export function classLabel(
  classId: number | undefined,
  labels: Record<string, string> | undefined,
): string {
  if (classId == null) {
    return "";
  }
  return labels?.[String(classId)] ?? String(classId);
}
