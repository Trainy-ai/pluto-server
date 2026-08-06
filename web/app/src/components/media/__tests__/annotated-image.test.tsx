/**
 * The mask overlay is the risky half of the annotations feature: it loads
 * images, reads their pixels back and writes new ones into a canvas that is
 * reused as the user steps through a run. Everything asserted here is a bug
 * that shipped and was fixed, not a hypothetical:
 *
 * - a stale mask stayed painted over the *next* image, because the effect
 *   returned early before clearing and the canvas keeps its pixels when its
 *   width attribute does not change;
 * - class ids were resolved to colours with a regex per pixel;
 * - hiding a layer had to actually take it off the canvas, not just grey out
 *   the button.
 *
 * jsdom has no canvas and never loads images, so both are stubbed. The stubs
 * are deliberately dumb: they record calls, and the tests assert on the calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { AnnotatedImage, compositeAnnotatedImage } from "../annotated-image";
import { classColour, type ImageAnnotations } from "@/lib/image-annotations";

const IMAGE_W = 8;
const IMAGE_H = 4;
const MASK_W = 2;
const MASK_H = 2;

/** The 2d context calls the component makes, captured per canvas. */
interface FakeContext {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
}

let contexts: FakeContext[] = [];
/** Pixels the mask PNG "contains", as class ids in the red channel. */
let maskPixels: number[] = [];
/** Every `new Image()` the component made, so tests can drive their loads. */
let pendingImages: FakeImage[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = null;
  naturalWidth = MASK_W;
  naturalHeight = MASK_H;
  #src = "";

  constructor() {
    pendingImages.push(this);
  }

  get src() {
    return this.#src;
  }

  // Loading is not automatic: a test decides when (and whether) each mask
  // arrives, which is the only way to assert on ordering and on cleanup.
  set src(value: string) {
    this.#src = value;
  }
}

function makeContext(): FakeContext {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => {
      // 4 bytes per pixel; only the red channel carries the class id.
      const data = new Uint8ClampedArray(MASK_W * MASK_H * 4);
      maskPixels.forEach((classId, i) => {
        data[i * 4] = classId;
        data[i * 4 + 3] = 255;
      });
      return { data, width: MASK_W, height: MASK_H };
    }),
    putImageData: vi.fn(),
    imageSmoothingEnabled: true,
  };
}

/** Resolve every outstanding mask load and flush the resulting draw. */
async function loadAllMasks() {
  await act(async () => {
    for (const img of pendingImages) {
      img.onload?.();
    }
    pendingImages = [];
  });
}

/**
 * jsdom reports naturalWidth 0 and never fires load, so the size the overlays
 * depend on has to be installed by hand.
 */
function loadBaseImage() {
  const img = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: IMAGE_W, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: IMAGE_H, configurable: true });
  fireEvent.load(img);
  return img;
}

// Every class the probe uses is labelled, because wandb only tints classes that
// appear in class_labels — an unlabelled id draws nothing at all.
const ALL_LABELLED = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [String(i), `class_${i}`]),
);

const withMask = (fileName = "m.png"): ImageAnnotations => ({
  masks: { predictions: { fileName, class_labels: ALL_LABELLED } },
});

const MASK_URLS: Record<string, string> = {
  "m.png": "https://s3/m.png",
  "m2.png": "https://s3/m2.png",
};
const maskUrlFor = (name: string) => MASK_URLS[name];

beforeEach(() => {
  contexts = [];
  pendingImages = [];
  maskPixels = [0, 1, 2, 3];

  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // One context per canvas, like the real thing: a fresh object per call would
  // hide exactly the bug these tests exist for, since the component re-reads
  // the context each time the effect runs and would appear to clear a canvas
  // nobody can observe.
  const perCanvas = new WeakMap<HTMLCanvasElement, FakeContext>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let ctx = perCanvas.get(this);
    if (!ctx) {
      ctx = makeContext();
      perCanvas.set(this, ctx);
      contexts.push(ctx);
    }
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AnnotatedImage mask canvas", () => {
  it("does not leave the previous image's mask painted over the next one", async () => {
    // The exact regression: cards are reused across steps, and consecutive
    // images in a log share their dimensions, so the canvas element is not
    // recreated and keeps whatever was drawn into it.
    const { rerender } = render(
      <AnnotatedImage
        src="a.png"
        annotations={withMask()}
        maskUrl={maskUrlFor}
      />,
    );
    loadBaseImage();
    await loadAllMasks();
    expect(contexts[0].drawImage).toHaveBeenCalled();

    // Next image: boxes only, no masks at all.
    rerender(
      <AnnotatedImage
        src="b.png"
        annotations={{ boxes: { predictions: { box_data: [] } } }}
        maskUrl={maskUrlFor}
      />,
    );

    // Nothing can be stale if there is no canvas to be stale.
    expect(screen.queryByTestId("annotation-masks")).toBeNull();
  });

  it("clears the canvas before deciding there is nothing left to draw", async () => {
    // The same hazard when the layer still exists but resolves to nothing —
    // here the canvas stays mounted, so the clear is what protects it.
    const { rerender } = render(
      <AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />,
    );
    loadBaseImage();
    await loadAllMasks();

    const ctx = contexts[0];
    const drawsAfterFirstPass = ctx.drawImage.mock.calls.length;
    ctx.clearRect.mockClear();

    // Same mask layer, but its file is no longer resolvable.
    rerender(
      <AnnotatedImage
        src="a.png"
        annotations={withMask("gone.png")}
        maskUrl={maskUrlFor}
      />,
    );
    await loadAllMasks();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, IMAGE_W, IMAGE_H);
    expect(ctx.drawImage.mock.calls.length).toBe(drawsAfterFirstPass);
  });

  it("leaves classes absent from class_labels completely clear", async () => {
    // wandb's rule, verified against their bundle: the colour map is built from
    // class_labels and everything else falls back to a transparent
    // DEFAULT_CLASS_COLOR = [0,0,0,0]. There is no special case for id 0 — an
    // unlabelled background stays clear, and so does any other unlabelled id.
    maskPixels = [0, 1, 2, 7];
    render(
      <AnnotatedImage
        src="a.png"
        annotations={{
          masks: {
            predictions: { fileName: "m.png", class_labels: { 1: "cat", 2: "dog" } },
          },
        }}
        maskUrl={maskUrlFor}
      />,
    );
    loadBaseImage();
    await loadAllMasks();

    const written = contexts[1].putImageData.mock.calls[0][0] as ImageData;
    const alphaAt = (i: number) => written.data[i * 4 + 3];
    expect(alphaAt(0)).toBe(0); // class 0, unlabelled -> clear
    expect(alphaAt(1)).toBeGreaterThan(0); // class 1, labelled -> tinted
    expect(alphaAt(2)).toBeGreaterThan(0); // class 2, labelled -> tinted
    expect(alphaAt(3)).toBe(0); // class 7, unlabelled -> clear
  });

  it("tints class 0 when it IS labelled", async () => {
    // The other half of the same rule: id 0 is not special, membership is.
    maskPixels = [0, 0, 0, 0];
    render(
      <AnnotatedImage
        src="a.png"
        annotations={{
          masks: {
            predictions: { fileName: "m.png", class_labels: { 0: "background" } },
          },
        }}
        maskUrl={maskUrlFor}
      />,
    );
    loadBaseImage();
    await loadAllMasks();

    const written = contexts[1].putImageData.mock.calls[0][0] as ImageData;
    expect(written.data[3]).toBeGreaterThan(0);
  });

  it("recolours each pixel from its class id and scales without smoothing", async () => {
    maskPixels = [0, 1, 0, 2];
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    loadBaseImage();
    await loadAllMasks();

    // The offscreen canvas is the second context created (the visible mask
    // canvas is the first).
    const offscreen = contexts[1];
    expect(offscreen.putImageData).toHaveBeenCalled();
    const written = offscreen.putImageData.mock.calls[0][0] as ImageData;

    const expectedRgb = (classId: number) => {
      const n = parseInt(classColour(classId).slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    maskPixels.forEach((classId, i) => {
      expect([
        written.data[i * 4],
        written.data[i * 4 + 1],
        written.data[i * 4 + 2],
      ]).toEqual(expectedRgb(classId));
      // Uniform alpha — the mask is a tint, not the picture.
      expect(written.data[i * 4 + 3]).toBe(115);
    });

    // Nearest-neighbour, or upscaling invents colours between two classes.
    expect(contexts[0].imageSmoothingEnabled).toBe(false);
    expect(contexts[0].drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      IMAGE_W,
      IMAGE_H,
    );
  });

  it("stops drawing a layer that has been toggled off", async () => {
    render(
      <AnnotatedImage
        src="a.png"
        annotations={withMask()}
        maskUrl={maskUrlFor}
        showLayerToggles
      />,
    );
    loadBaseImage();
    await loadAllMasks();

    const ctx = contexts[0];
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    ctx.clearRect.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTestId("annotation-layer-predictions"));
    });
    await loadAllMasks();

    // Cleared, and nothing redrawn: the layer is genuinely off the canvas
    // rather than merely struck through in the toggle row.
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("annotation-layer-predictions").className).toContain(
      "line-through",
    );
  });

  it("detaches handlers from loads still in flight when it re-runs", async () => {
    const { rerender } = render(
      <AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />,
    );
    loadBaseImage();
    const inFlight = pendingImages[0];
    expect(inFlight).toBeDefined();

    // Re-run the effect while the first mask is still loading.
    rerender(
      <AnnotatedImage
        src="a.png"
        annotations={withMask("gone.png")}
        maskUrl={maskUrlFor}
      />,
    );

    expect(inFlight.onload).toBeNull();
    expect(inFlight.onerror).toBeNull();
    expect(inFlight.src).toBe("");
  });

  it("warns and keeps going when a mask fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    loadBaseImage();

    await act(async () => {
      pendingImages.forEach((img) => img.onerror?.());
      pendingImages = [];
    });

    expect(warn).toHaveBeenCalled();
    expect(contexts[0].drawImage).not.toHaveBeenCalled();
  });
});

describe("AnnotatedImage state resets on src, not on remount", () => {
  // The grids key their cards by grid POSITION, deliberately: a key that
  // changed per image unmounts the card and destroys the fullscreen Radix
  // dialog inside it mid-interaction (the "[IR-C] dialog persists on step
  // change" E2E). So the same component instance is reused for a different
  // picture, and every one of these has to be dropped off `src` instead.

  it("clears the previous image's mask when src changes without a remount", async () => {
    const { rerender } = render(
      <AnnotatedImage src="a.png" annotations={withMask("m.png")} maskUrl={maskUrlFor} />,
    );
    loadBaseImage();
    await loadAllMasks();

    const ctx = contexts[0];
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    ctx.clearRect.mockClear();

    // Step to a different image whose mask layer resolves nowhere. Same
    // instance, same canvas element, same dimensions — so nothing but the
    // explicit clear can stop the old mask staying on screen.
    rerender(
      <AnnotatedImage
        src="b.png"
        annotations={withMask("missing.png")}
        maskUrl={maskUrlFor}
      />,
    );
    await loadAllMasks();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, IMAGE_W, IMAGE_H);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1); // nothing new drawn
  });

  it("draws the new image's mask when src changes without a remount", async () => {
    const { rerender } = render(
      <AnnotatedImage src="a.png" annotations={withMask("m.png")} maskUrl={maskUrlFor} />,
    );
    loadBaseImage();
    await loadAllMasks();
    expect(contexts[0].drawImage).toHaveBeenCalledTimes(1);

    rerender(
      <AnnotatedImage src="b.png" annotations={withMask("m2.png")} maskUrl={maskUrlFor} />,
    );
    await loadAllMasks();

    expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
  });

  it("stops suppressing layers hidden on the previous image", async () => {
    const { rerender } = render(
      <AnnotatedImage
        src="a.png"
        annotations={withMask("m.png")}
        maskUrl={maskUrlFor}
        showLayerToggles
      />,
    );
    loadBaseImage();
    await loadAllMasks();

    await act(async () => {
      fireEvent.click(screen.getByTestId("annotation-layer-predictions"));
    });
    await loadAllMasks();
    expect(screen.getByTestId("annotation-layer-predictions").className).toContain(
      "line-through",
    );
    const drawsWhileHidden = contexts[0].drawImage.mock.calls.length;

    // Next image: the layer must come back, or its mask is invisible with no
    // indication why.
    rerender(
      <AnnotatedImage
        src="b.png"
        annotations={withMask("m2.png")}
        maskUrl={maskUrlFor}
        showLayerToggles
      />,
    );
    await loadAllMasks();

    expect(screen.getByTestId("annotation-layer-predictions").className).not.toContain(
      "line-through",
    );
    expect(contexts[0].drawImage.mock.calls.length).toBe(drawsWhileHidden + 1);
  });

  it("keeps hidden layers while the same image is re-rendered", async () => {
    // The reset keys off src, so an unrelated re-render must not undo a
    // deliberate toggle.
    const { rerender } = render(
      <AnnotatedImage
        src="a.png"
        annotations={withMask("m.png")}
        maskUrl={maskUrlFor}
        showLayerToggles
      />,
    );
    loadBaseImage();
    await loadAllMasks();

    fireEvent.click(screen.getByTestId("annotation-layer-predictions"));
    rerender(
      <AnnotatedImage
        src="a.png"
        annotations={withMask("m.png")}
        maskUrl={maskUrlFor}
        showLayerToggles
        alt="unrelated change"
      />,
    );

    expect(screen.getByTestId("annotation-layer-predictions").className).toContain(
      "line-through",
    );
  });
});

describe("AnnotatedImage CORS fallback", () => {
  // An S3 bucket with no CORS configuration sends no
  // Access-Control-Allow-Origin, and a crossOrigin request for it fails
  // outright — a *broken image*, not merely an un-downloadable one. The
  // overlays are separate elements and are unaffected; only the flattened
  // download degrades.
  const baseImg = () => screen.getByRole("img", { hidden: true }) as HTMLImageElement;

  it("asks for CORS first", () => {
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    expect(baseImg().getAttribute("crossorigin")).toBe("anonymous");
  });

  it("retries without CORS when the first load fails, and still renders", () => {
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    fireEvent.error(baseImg());

    const retried = baseImg();
    expect(retried.getAttribute("crossorigin")).toBeNull();
    expect(retried.getAttribute("src")).toBe("a.png");

    // And the plain load still drives the overlays.
    Object.defineProperty(retried, "naturalWidth", { value: IMAGE_W, configurable: true });
    Object.defineProperty(retried, "naturalHeight", { value: IMAGE_H, configurable: true });
    fireEvent.load(retried);
    expect(screen.getByTestId("annotation-masks")).toBeDefined();
  });

  it("retries at most once, so a permanently broken src cannot loop", () => {
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    fireEvent.error(baseImg());
    const afterFirst = baseImg();
    // The second failure has no crossOrigin left to drop.
    fireEvent.error(afterFirst);
    fireEvent.error(baseImg());
    expect(baseImg().getAttribute("crossorigin")).toBeNull();
    expect(baseImg()).toBe(afterFirst);
  });

  it("asks for CORS again when the src changes", () => {
    // Otherwise one failure would permanently downgrade every later image in a
    // reused card, losing overlay downloads that would have worked.
    const { rerender } = render(
      <AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />,
    );
    fireEvent.error(baseImg());
    expect(baseImg().getAttribute("crossorigin")).toBeNull();

    rerender(<AnnotatedImage src="b.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    expect(baseImg().getAttribute("crossorigin")).toBe("anonymous");
  });
});

describe("compositeAnnotatedImage", () => {
  it("returns null when the canvas is tainted, so callers fall back to the raw URL", () => {
    // The whole point of the fallback: on a no-CORS object store the image is
    // drawn fine but reading it back throws, and this must degrade to the raw
    // file rather than producing a broken or empty download. This failure was
    // silent once already on this branch.
    const { container } = render(
      <AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />,
    );
    const img = screen.getByRole("img", { hidden: true });
    Object.defineProperty(img, "naturalWidth", { value: IMAGE_W, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: IMAGE_H, configurable: true });
    fireEvent.load(img);

    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new DOMException("Tainted canvases may not be exported", "SecurityError");
    });

    return expect(compositeAnnotatedImage(container)).resolves.toBeNull();
  });

  it("returns a data URL when the canvas is readable", () => {
    const { container } = render(
      <AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />,
    );
    const img = screen.getByRole("img", { hidden: true });
    Object.defineProperty(img, "naturalWidth", { value: IMAGE_W, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: IMAGE_H, configurable: true });
    fireEvent.load(img);

    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");

    return expect(compositeAnnotatedImage(container)).resolves.toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("returns null when there is nothing rendered to composite", () =>
    expect(compositeAnnotatedImage(null)).resolves.toBeNull());
});

describe("AnnotatedImage overlays", () => {
  it("mounts no canvas when the image only carries boxes", () => {
    render(
      <AnnotatedImage
        src="a.png"
        annotations={{ boxes: { predictions: { box_data: [] } } }}
      />,
    );
    loadBaseImage();

    // A canvas costs naturalWidth x naturalHeight x 4 bytes whether or not it
    // is used, which across a grid of tiles is tens of megabytes for nothing.
    expect(screen.queryByTestId("annotation-masks")).toBeNull();
    expect(screen.getByTestId("annotation-boxes")).toBeDefined();
  });

  it("mounts no box overlay when the image only carries masks", () => {
    render(<AnnotatedImage src="a.png" annotations={withMask()} maskUrl={maskUrlFor} />);
    loadBaseImage();

    expect(screen.queryByTestId("annotation-boxes")).toBeNull();
    expect(screen.getByTestId("annotation-masks")).toBeDefined();
  });

  it("removes a hidden layer's boxes from the overlay", async () => {
    const annotations: ImageAnnotations = {
      boxes: {
        predictions: {
          box_data: [
            { position: { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 }, class_id: 1 },
          ],
        },
        ground_truth: {
          box_data: [
            { position: { minX: 0.5, minY: 0.5, maxX: 1, maxY: 1 }, class_id: 2 },
          ],
        },
      },
    };
    render(<AnnotatedImage src="a.png" annotations={annotations} showLayerToggles />);
    loadBaseImage();

    // One <g> per box — counting <rect> would also pick up each label's
    // backing plate.
    const boxCount = () =>
      screen.getByTestId("annotation-boxes").querySelectorAll("g").length;
    expect(boxCount()).toBe(2);

    fireEvent.click(screen.getByTestId("annotation-layer-ground_truth"));
    expect(boxCount()).toBe(1);
  });
});
