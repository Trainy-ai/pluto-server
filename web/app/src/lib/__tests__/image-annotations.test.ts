/**
 * Image annotation parsing and box geometry.
 *
 * `resolveBox` earns its own tests: wandb treats coordinates as fractions of
 * 0-1 unless a box says `domain: "pixel"`, and getting it backwards draws
 * nothing and reports no error. That exact mistake made seeded demo data render
 * blank with no clue why, so the two interpretations are pinned here rather
 * than left to be rediscovered.
 */

import { describe, it, expect } from "vitest";
import {
  parseAnnotations,
  resolveBox,
  classColour,
  classLabel,
  labelledClassIds,
  layerNames,
  CLASS_RGB_LUT,
  type AnnotationBox,
} from "../image-annotations";

const box = (position: AnnotationBox["position"], domain?: string): AnnotationBox => ({
  position,
  ...(domain ? { domain } : {}),
});

describe("resolveBox", () => {
  it("treats coordinates as pixels when the box says so", () => {
    const r = resolveBox(box({ minX: 10, minY: 20, maxX: 110, maxY: 220 }, "pixel"), 480, 320);
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it("treats them as fractions of the image when it does not", () => {
    // wandb's default. 0.5 of a 480px image is 240px, not 0.5px.
    const r = resolveBox(box({ minX: 0.25, minY: 0.5, maxX: 0.75, maxY: 1 }), 480, 320);
    expect(r).toEqual({ x: 120, y: 160, width: 240, height: 160 });
  });

  it("puts pixel values far off-canvas if read as fractions", () => {
    // The failure mode this whole function exists for: same numbers, wildly
    // different result, and nothing errors.
    const asPixels = resolveBox(box({ minX: 38, minY: 48, maxX: 118, maxY: 158 }, "pixel"), 480, 320);
    const asFractions = resolveBox(box({ minX: 38, minY: 48, maxX: 118, maxY: 158 }), 480, 320);
    expect(asPixels.x).toBe(38);
    expect(asFractions.x).toBe(38 * 480);
    expect(asFractions.x).toBeGreaterThan(480); // entirely outside the image
  });

  it("normalises a box given with its corners reversed", () => {
    const r = resolveBox(box({ minX: 110, minY: 220, maxX: 10, maxY: 20 }, "pixel"), 480, 320);
    expect(r).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it("handles a zero-area box without producing negatives", () => {
    const r = resolveBox(box({ minX: 50, minY: 50, maxX: 50, maxY: 50 }, "pixel"), 480, 320);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});

describe("parseAnnotations", () => {
  it("parses boxes and masks", () => {
    const parsed = parseAnnotations(
      JSON.stringify({
        boxes: { predictions: { box_data: [], class_labels: { 1: "cat" } } },
        masks: { predictions: { fileName: "m.png" } },
      }),
    );
    expect(Object.keys(parsed!.boxes!)).toEqual(["predictions"]);
    expect(parsed!.masks!.predictions.fileName).toBe("m.png");
  });

  it("returns null rather than throwing on anything unusable", () => {
    // A bad blob must degrade to a plain image, never take the card down.
    expect(parseAnnotations(null)).toBeNull();
    expect(parseAnnotations(undefined)).toBeNull();
    expect(parseAnnotations("")).toBeNull();
    expect(parseAnnotations("not json")).toBeNull();
    expect(parseAnnotations("[1,2,3]")).toBeNull();
    // Structurally valid but carrying nothing to draw.
    expect(parseAnnotations("{}")).toBeNull();
    expect(parseAnnotations('{"boxes":{},"masks":{}}')).toBeNull();
  });
});

describe("layers and colours", () => {
  it("lists every layer across boxes and masks, without duplicates", () => {
    const names = layerNames({
      boxes: { predictions: { box_data: [] }, ground_truth: { box_data: [] } },
      masks: { predictions: { fileName: "m.png" } },
    });
    expect(names).toEqual(["ground_truth", "predictions"]);
  });

  it("gives a class the same colour everywhere", () => {
    // Comparing "predicted cat" against "actual cat" only works if both are
    // the same colour, across the box layer and the mask layer.
    expect(classColour(2)).toBe(classColour(2));
    expect(classColour(1)).not.toBe(classColour(2));
  });

  it("matches wandb's palette, which is 16 wide and only then repeats", () => {
    // Read off wandb's own bundle: ROBIN16 = a 16-entry permutation of
    // COLORS16, indexed `id % palette.length`. The previous 10-colour palette
    // collided class 1 with class 11 — well inside the range a real
    // segmentation run uses.
    expect(classColour(0)).toBe("#538AE5");
    expect(classColour(1)).toBe("#F0434F");
    expect(classColour(15)).toBe("#A1A9AD");
    expect(classColour(1)).not.toBe(classColour(11));
    expect(classColour(16)).toBe(classColour(0));
    expect(classColour(17)).toBe(classColour(1));
  });
});

describe("labelledClassIds", () => {
  // wandb builds its mask colour map from class_labels and leaves every other
  // id transparent, so this set is what decides whether a pixel is tinted.
  it("collects the ids present in class_labels", () => {
    expect(labelledClassIds({ 0: "background", 3: "dog" })).toEqual(new Set([0, 3]));
  });

  it("is empty for a mask with no labels at all", () => {
    // Matches wandb: such a mask renders nothing.
    expect(labelledClassIds(undefined)).toEqual(new Set());
    expect(labelledClassIds({})).toEqual(new Set());
  });

  it("ignores keys that are not class ids", () => {
    expect(labelledClassIds({ cat: "x", "-1": "y", "2": "z" })).toEqual(new Set([2]));
  });
});

describe("CLASS_RGB_LUT", () => {
  // The mask renderer reads colours from this table instead of deriving them
  // per pixel. That is only safe while it agrees with `classColour`, which is
  // what the box layer draws with — if the two drift, a class is one colour as
  // a box and another as a mask, and the whole point of the feature is that
  // they match.
  it("covers every value an 8-bit mask channel can hold", () => {
    expect(CLASS_RGB_LUT).toHaveLength(256 * 3);
  });

  it("agrees with classColour for every class id", () => {
    for (let id = 0; id < 256; id++) {
      const hex = classColour(id);
      const n = parseInt(hex.slice(1), 16);
      expect([
        CLASS_RGB_LUT[id * 3],
        CLASS_RGB_LUT[id * 3 + 1],
        CLASS_RGB_LUT[id * 3 + 2],
      ]).toEqual([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
  });

  it("falls back to the raw class id when there is no label", () => {
    expect(classLabel(3, { 3: "dog" })).toBe("dog");
    expect(classLabel(3, undefined)).toBe("3");
    expect(classLabel(undefined, { 3: "dog" })).toBe("");
  });
});
