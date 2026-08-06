import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { cn } from "@/lib/utils";
import {
  CLASS_RGB_LUT,
  classColour,
  classLabel,
  labelledClassIds,
  layerNames,
  resolveBox,
  type ImageAnnotations,
} from "@/lib/image-annotations";
import type { MaskUrlResolver } from "@/hooks/use-mask-url";

interface AnnotatedImageProps {
  src: string;
  alt?: string;
  annotations: ImageAnnotations;
  /**
   * Resolves a mask's fileName to a URL in the same log group.
   *
   * Must be identity-stable — see `@/hooks/use-mask-url`. An inline arrow here
   * re-runs the mask pipeline on every parent render and makes the overlay
   * blink, because the effect below has to depend on what this resolves to.
   */
  maskUrl?: MaskUrlResolver;
  className?: string;
  /**
   * Applied to the `<img>`. The fullscreen viewer sizes the image explicitly
   * from its zoom scale, and the overlays size themselves to the image, so
   * they follow zoom and pan without knowing anything about them.
   */
  imgStyle?: CSSProperties;
  imgClassName?: string;
  /**
   * Applied to the box holding the image and its overlays. Use this, not
   * `imgStyle`, for anything that changes apparent size — a CSS transform on
   * the image alone scales the picture while the absolutely-positioned
   * overlays stay put, so boxes drift off their objects.
   */
  wrapperStyle?: CSSProperties;
  /**
   * Show the per-layer toggles. Off by default: in a grid cell they crowd the
   * picture, and there is rarely room. Enabled where the image is large — the
   * fullscreen viewer and the widget's fullscreen dialog.
   */
  showLayerToggles?: boolean;
  /** Forwarded so a parent can still read naturalWidth/Height for zoom. */
  onImageLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

/** Shared empty set, so resetting the hidden layers allocates nothing. */
const NO_HIDDEN_LAYERS: ReadonlySet<string> = new Set<string>();

/** Masks are drawn under boxes at this opacity, so boxes stay readable. */
const MASK_ALPHA = 0.45;
const MASK_ALPHA_BYTE = Math.round(MASK_ALPHA * 255);

/**
 * RGBA lookup for one mask layer, indexed by class id: `lut[id * 4 + {0..3}]`.
 *
 * Alpha carries the "should this class be drawn at all" decision, so the
 * per-pixel loop stays four array reads with no branch. Ids absent from
 * `class_labels` get alpha 0, matching wandb, whose colour map is built from
 * `class_labels` and falls back to a transparent `DEFAULT_CLASS_COLOR` for
 * everything else — which is why an unlabelled background stays clear there.
 */
function buildLayerLut(labelled: Set<number>): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (const id of labelled) {
    if (id > 255) {
      // A mask channel is 8-bit, so no pixel can carry this id.
      continue;
    }
    lut[id * 4] = CLASS_RGB_LUT[id * 3];
    lut[id * 4 + 1] = CLASS_RGB_LUT[id * 3 + 1];
    lut[id * 4 + 2] = CLASS_RGB_LUT[id * 3 + 2];
    lut[id * 4 + 3] = MASK_ALPHA_BYTE;
  }
  return lut;
}

/**
 * Recolour one loaded mask onto the target context.
 *
 * The mask's pixels are class ids, not colours, so this is a genuine per-pixel
 * transform. Two things keep it cheap: the palette is a module-level lookup
 * table (`CLASS_RGB_LUT`) rather than colour strings parsed per pixel, and the
 * pixels are rewritten in place instead of into a second full-size buffer.
 *
 * Returns false when the mask could not be read, so the caller can warn once
 * rather than failing the whole overlay.
 */
function drawRecolouredMask(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  lut: Uint8Array,
): boolean {
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const offCtx = off.getContext("2d", { willReadFrequently: true });
  if (!offCtx || !off.width || !off.height) {
    return false;
  }
  offCtx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = offCtx.getImageData(0, 0, off.width, off.height);
  } catch {
    // Tainted canvas (mask served without CORS) — skip rather than throw.
    return false;
  }

  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    // Class id lives in the red channel, as it does in wandb's own reader.
    // Unlabelled ids resolve to alpha 0 through the layer's LUT, so the photo
    // shows through untinted rather than being washed over.
    const base = px[i] * 4;
    px[i] = lut[base];
    px[i + 1] = lut[base + 1];
    px[i + 2] = lut[base + 2];
    px[i + 3] = lut[base + 3];
  }
  offCtx.putImageData(data, 0, 0);

  // Nearest-neighbour: the pixels are class colours now, so interpolating a
  // lower-resolution mask up to the image would invent fringe colours that
  // belong to neither adjacent class.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, targetWidth, targetHeight);
  return true;
}

/**
 * An image with its bounding boxes and segmentation masks drawn on top.
 *
 * Boxes are SVG rather than canvas: there are rarely more than a few dozen, and
 * SVG keeps them crisp at any zoom, scales with the image through a viewBox,
 * and needs no redraw on resize.
 *
 * Masks have to be canvas. A mask PNG encodes a *class id* per pixel, not a
 * colour — a raw one is a near-black image, since ids are small integers. It is
 * only meaningful after recolouring each pixel by its class, which means
 * reading the pixels and writing new ones.
 *
 * Layers are toggleable and default to all-on. The reason the feature exists is
 * comparing a model's prediction against the truth on one picture, so switching
 * between them is the primary interaction, not a detail.
 */
export function AnnotatedImage({
  src,
  alt,
  annotations,
  maskUrl,
  className,
  imgStyle,
  imgClassName,
  wrapperStyle,
  showLayerToggles = false,
  onImageLoad,
}: AnnotatedImageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // How many natural pixels one CSS pixel covers. The SVG uses a viewBox in
  // natural pixels, so anything sized in those units grows with the image —
  // fine for the boxes, wrong for the labels, which should stay a constant
  // size on screen the way wandb's do rather than becoming billboards when
  // zoomed in and illegible in a thumbnail.
  const [renderedWidth, setRenderedWidth] = useState(0);
  const names = useMemo(() => layerNames(annotations), [annotations]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_HIDDEN_LAYERS);
  // Whether this image had to be re-requested without CORS. See the <img>.
  const [corsFailed, setCorsFailed] = useState(false);

  // Everything per-image resets here, off `src`, rather than off a remount.
  //
  // The grids that host this component key their cards by grid position on
  // purpose — a key that changed per image would unmount the card and take the
  // fullscreen dialog down with it mid-interaction. So the component instance
  // is reused for a different picture, and any state describing the *previous*
  // picture has to be dropped explicitly:
  //
  //   * `hidden` — layer names are per image; carrying them over silently
  //     suppressed layers on the next one.
  //   * `corsFailed` — a new image must get its own chance at a CORS request,
  //     or one failure would permanently downgrade every later image here.
  //
  // Adjusting state during render (rather than in an effect) is the supported
  // pattern: React re-renders immediately without committing the stale value,
  // so nothing paints with the previous image's state.
  const renderedSrc = useRef(src);
  if (renderedSrc.current !== src) {
    renderedSrc.current = src;
    if (corsFailed) {
      setCorsFailed(false);
    }
    if (hidden.size > 0) {
      setHidden(NO_HIDDEN_LAYERS);
    }
  }

  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });

  // Only mount an overlay that has something to put in it. A canvas costs
  // naturalWidth x naturalHeight x 4 bytes of backing store whether or not
  // anything is drawn into it, which across a grid of tiles is tens of
  // megabytes for images that only ever carry boxes.
  const hasMasks = !!annotations.masks && Object.keys(annotations.masks).length > 0;
  const hasBoxes = !!annotations.boxes && Object.keys(annotations.boxes).length > 0;

  // Resolve the URLs outside the effect so the effect can depend on *what they
  // resolve to* rather than on the resolver's identity. In layer order, so the
  // composite is deterministic instead of depending on which image loads first.
  const maskJobs = useMemo(() => {
    if (!annotations.masks || !maskUrl) {
      return [] as { name: string; url: string; lut: Uint8Array }[];
    }
    return Object.entries(annotations.masks)
      .filter(([name, layer]) => !hidden.has(name) && !!layer.fileName)
      .map(([name, layer]) => ({
        name,
        url: maskUrl(layer.fileName!),
        // Per layer, since each carries its own class_labels.
        lut: buildLayerLut(labelledClassIds(layer.class_labels)),
      }))
      .filter(
        (job): job is { name: string; url: string; lut: Uint8Array } => !!job.url,
      );
  }, [annotations.masks, maskUrl, hidden]);
  const maskJobsKey = maskJobs.map((job) => `${job.name}=${job.url}`).join("|");

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setRenderedWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Recolour every visible mask onto one canvas sized to the natural image.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !size) {
      return;
    }

    // Clear *before* deciding there is nothing to draw. Cards are reused across
    // steps, and the canvas element keeps its pixels when the width attribute
    // does not change — which it does not when consecutive images share their
    // dimensions — so an early return here left the previous image's mask
    // painted over the new one.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (maskJobs.length === 0) {
      return;
    }

    let cancelled = false;
    const images: HTMLImageElement[] = [];

    // Load in parallel, draw in layer order. Drawing as each one arrives would
    // make the blend depend on network timing, so two layers composited
    // differently on a warm cache than on a cold one.
    const loads = maskJobs.map(
      ({ name, url }) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          images.push(img);
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => {
            console.warn(`[AnnotatedImage] mask layer "${name}" failed to load`, url);
            resolve(null);
          };
          img.src = url;
        }),
    );

    void Promise.all(loads).then((loaded) => {
      if (cancelled) {
        return;
      }
      loaded.forEach((img, i) => {
        if (!img) {
          return;
        }
        if (
          !drawRecolouredMask(
            ctx,
            img,
            canvas.width,
            canvas.height,
            maskJobs[i].lut,
          )
        ) {
          console.warn(
            `[AnnotatedImage] mask layer "${maskJobs[i].name}" could not be read`,
          );
        }
      });
    });

    return () => {
      cancelled = true;
      // Detach before dropping the reference so a decode still in flight cannot
      // resolve into a canvas this effect no longer owns.
      for (const img of images) {
        img.onload = null;
        img.onerror = null;
        img.src = "";
      }
    };
    // maskJobsKey stands in for maskJobs: same contents, stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskJobsKey, size]);

  // In viewBox units, so strokes and labels stay the same visual size whatever
  // the image is displayed at. Hoisted out of the per-box map — it is the same
  // for every box and recomputing it there ran on every resize tick.
  const perCssPx = size && renderedWidth > 0 ? size.width / renderedWidth : 1;
  const strokeWidth = 2 * perCssPx;
  const fontSize = 13 * perCssPx;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="annotated-image">
      <div ref={wrapperRef} className="relative inline-block" style={wrapperStyle}>
        <img
          // Remount on the retry so the browser re-requests rather than
          // reusing the failed CORS response from its cache.
          key={corsFailed ? "no-cors" : "cors"}
          src={src}
          alt={alt}
          className={cn("block h-auto w-full", imgClassName)}
          style={imgStyle}
          draggable={false}
          // Requested with CORS *when the object store allows it*, because a
          // canvas the image is drawn into is otherwise tainted and flattening
          // the overlays for download throws.
          //
          // It is not guaranteed: MinIO allows any origin by default, but an
          // S3 bucket with no CORS configuration sends no
          // Access-Control-Allow-Origin, and a crossOrigin request for it fails
          // outright — a broken image, not merely an un-downloadable one. So a
          // failure retries plainly below. The overlays are separate elements
          // and draw either way; only the flattened download degrades, falling
          // back to the raw file without the overlays burned in.
          crossOrigin={corsFailed ? undefined : "anonymous"}
          onError={() => {
            // At most once per src — `corsFailed` is the guard, and the retry
            // has no crossOrigin left to drop, so it cannot loop.
            if (!corsFailed) {
              setCorsFailed(true);
            }
          }}
          onLoad={(e) => {
            setSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            });
            onImageLoad?.(e);
          }}
        />

        {size && hasMasks && (
          <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="annotation-masks"
          />
        )}
        {/* viewBox in natural pixels, so boxes track the image at any
            rendered size without recomputing on resize. */}
        {size && hasBoxes && (
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="annotation-boxes"
          >
            {Object.entries(annotations.boxes ?? {}).map(([name, layer]) =>
              hidden.has(name)
                ? null
                : layer.box_data?.map((box, i) => {
                    const r = resolveBox(box, size.width, size.height);
                    const colour = classColour(box.class_id);
                    const label =
                      box.box_caption ?? classLabel(box.class_id, layer.class_labels);
                    return (
                      <g key={`${name}-${i}`}>
                        <rect
                          x={r.x}
                          y={r.y}
                          width={r.width}
                          height={r.height}
                          fill="none"
                          stroke={colour}
                          strokeWidth={strokeWidth}
                        />
                        {label && (
                          <>
                            <rect
                              x={r.x}
                              y={Math.max(r.y - fontSize * 1.25, 0)}
                              width={label.length * fontSize * 0.6 + fontSize * 0.4}
                              height={fontSize * 1.2}
                              fill={colour}
                            />
                            <text
                              x={r.x + fontSize * 0.2}
                              y={Math.max(r.y - fontSize * 0.35, fontSize * 0.85)}
                              fontSize={fontSize}
                              fill="#0b0b0f"
                              fontFamily="ui-monospace, monospace"
                            >
                              {label}
                            </text>
                          </>
                        )}
                      </g>
                    );
                  }),
            )}
          </svg>
        )}
        {/* Overlaid on the image rather than laid out beneath it. As a
            sibling below, the row sat inside the card's fixed-aspect,
            overflow-hidden box and got clipped — at narrow widths the second
            layer was cut off entirely, so a two-layer image looked like it
            had one. Absolutely positioned, it cannot be clipped by the card
            and costs no layout height. */}
        {showLayerToggles && names.length > 0 && (
          <div className="pointer-events-none absolute inset-x-1 bottom-1 z-10 flex flex-wrap items-center gap-1">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={(e) => {
                  // These sit inside the card's fullscreen trigger, so without
                  // this a click on a layer name also opened the dialog.
                  e.stopPropagation();
                  toggle(name);
                }}
                className={cn(
                  "pointer-events-auto cursor-pointer rounded bg-background/75 px-1.5 py-0.5 font-mono text-[10px] leading-tight backdrop-blur-sm transition-opacity",
                  hidden.has(name)
                    ? "text-muted-foreground/60 line-through"
                    : "text-foreground",
                )}
                data-testid={`annotation-layer-${name}`}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Flatten a rendered `AnnotatedImage` — base image, mask canvas and box SVG —
 * into one canvas, and return it as a data URL.
 *
 * Downloading previously re-fetched the original file, so the saved PNG had
 * none of the overlays the user was looking at. Compositing from the live DOM
 * rather than re-deriving from the annotation data means the export matches the
 * screen exactly, including which layers are toggled off.
 *
 * Returns null when there is nothing to composite, so callers can fall back to
 * the plain URL.
 */
export async function compositeAnnotatedImage(
  root: HTMLElement | null | undefined,
): Promise<string | null> {
  // Scoped to the annotated subtree: an unqualified `img` would pick up any
  // avatar or icon that happens to render before it inside the same container.
  const img =
    root?.querySelector<HTMLImageElement>('[data-testid="annotated-image"] img') ??
    null;
  if (!img || !img.naturalWidth) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const maskCanvas = root?.querySelector<HTMLCanvasElement>(
    '[data-testid="annotation-masks"]',
  );
  if (maskCanvas) {
    ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  }

  // Boxes are SVG, so they have to be rasterised. Serialising and loading the
  // live node keeps one implementation of the drawing rather than a second
  // canvas version that could drift from it.
  const svg = root?.querySelector<SVGSVGElement>('[data-testid="annotation-boxes"]');
  if (svg) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(canvas.width));
    clone.setAttribute("height", String(canvas.height));
    const markup = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    try {
      await new Promise<void>((resolve, reject) => {
        const overlay = new Image();
        overlay.onload = () => {
          ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
          resolve();
        };
        overlay.onerror = () => reject(new Error("box overlay failed to rasterise"));
        overlay.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    // Tainted by a cross-origin source — better to fall back than to throw.
    return null;
  }
}
