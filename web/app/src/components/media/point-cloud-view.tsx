import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface PointCloudViewProps {
  /** `[x, y, z]` triples, optionally with 3 extra channels (see below). */
  points: number[][];
  className?: string;
}

/** Above this, points are sampled down — see the comment in the effect. */
const MAX_POINTS = 200_000;

/**
 * A 3D point cloud (`wandb.Object3D`), drag to orbit and scroll to zoom.
 *
 * wandb stores these as a bare array of `[x, y, z]` triples. It also allows two
 * wider forms, both handled here: 6 columns is `xyz + rgb` (0-255), and 4 is
 * `xyz + category`, which gets a palette colour per category.
 *
 * `three` is imported dynamically — a project with no clouds never pays for it.
 * Rendered as a single `THREE.Points` with a flat buffer rather than per-point
 * objects, so a million-point cloud is one draw call.
 */
export function PointCloudView({ points, className }: PointCloudViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    // Clear any prior failure so a later `points` change can retry. The host
    // div must stay mounted (see return) — swapping it out for an error
    // message used to leave hostRef null and freeze the error forever.
    setError(null);

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import(
          "three/examples/jsm/controls/OrbitControls.js"
        );
        const host = hostRef.current;
        if (disposed || !host) return;

        // Decimate rather than refuse. A cloud far past this is
        // indistinguishable on screen, and uniform stride keeps the shape
        // rather than lopping off whichever end happens to be last.
        const stride = Math.max(1, Math.ceil(points.length / MAX_POINTS));
        const sampled = stride === 1 ? points : points.filter((_, i) => i % stride === 0);

        const positions = new Float32Array(sampled.length * 3);
        const colors = new Float32Array(sampled.length * 3);
        const hasRgb = sampled[0]?.length >= 6;
        const hasCategory = sampled[0]?.length === 4;
        const palette = [
          [0.38, 0.65, 0.98], [0.96, 0.45, 0.71], [0.29, 0.87, 0.5],
          [0.98, 0.75, 0.14], [0.66, 0.47, 0.98], [0.13, 0.83, 0.93],
        ];

        // One pass: fill positions and colours, and track the bounds so the
        // camera can frame the cloud whatever scale it's in.
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < sampled.length; i++) {
          const p = sampled[i];
          for (let a = 0; a < 3; a++) {
            positions[i * 3 + a] = p[a];
            if (p[a] < min[a]) min[a] = p[a];
            if (p[a] > max[a]) max[a] = p[a];
          }
          if (hasRgb) {
            colors[i * 3] = p[3] / 255;
            colors[i * 3 + 1] = p[4] / 255;
            colors[i * 3 + 2] = p[5] / 255;
          } else if (hasCategory) {
            const c = palette[Math.abs(Math.round(p[3])) % palette.length];
            colors[i * 3] = c[0];
            colors[i * 3 + 1] = c[1];
            colors[i * 3 + 2] = c[2];
          } else {
            colors[i * 3] = 0.38;
            colors[i * 3 + 1] = 0.65;
            colors[i * 3 + 2] = 0.98;
          }
        }

        const centre = min.map((v, i) => (v + max[i]) / 2);
        const span = Math.max(...max.map((v, i) => v - min[i]), 1e-6);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
          // Relative to the cloud's own extent, so a cloud in metres and one in
          // millimetres both come out legible. /60 puts a point at roughly 8px
          // at the framing distance below — /180 rendered as single dim pixels.
          size: span / 60,
          vertexColors: true,
          sizeAttenuation: true,
        });

        const scene = new THREE.Scene();
        scene.add(new THREE.Points(geometry, material));

        const width = host.clientWidth || 400;
        const height = host.clientHeight || 300;
        const camera = new THREE.PerspectiveCamera(50, width / height, span / 1000, span * 100);
        camera.position.set(centre[0] + span, centre[1] + span, centre[2] + span);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);
        host.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(centre[0], centre[1], centre[2]);
        controls.enableDamping = true;
        controls.update();

        // Render on demand rather than a rAF loop: a static cloud that nobody
        // is touching should cost nothing, and several on one page would
        // otherwise each burn a frame budget forever.
        let rafId = 0;
        const draw = () => {
          rafId = 0;
          controls.update();
          renderer.render(scene, camera);
        };
        const request = () => {
          // rafId doubles as the "already queued" flag, so the handle is
          // available to cancel below. Without cancelling, a frame queued as
          // the tile scrolls away runs *after* teardown and renders a disposed
          // scene into a detached canvas.
          if (!rafId) {
            rafId = requestAnimationFrame(draw);
          }
        };
        controls.addEventListener("change", request);
        draw();

        const observer = new ResizeObserver(() => {
          const w = host.clientWidth || 400;
          const h = host.clientHeight || 300;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
          request();
        });
        observer.observe(host);

        cleanup = () => {
          if (rafId) cancelAnimationFrame(rafId);
          observer.disconnect();
          controls.removeEventListener("change", request);
          controls.dispose();
          geometry.dispose();
          material.dispose();
          // `dispose()` alone does NOT free the GPU context — it only detaches
          // three's canvas listeners and drops its internal caches (render
          // lists, programs, properties). The context lives until the canvas
          // is garbage collected, which is non-deterministic. Browsers cap
          // live contexts (~16), so on a page of clouds the later ones render
          // blank. `forceContextLoss()` releases it immediately via
          // WEBGL_lose_context, and must run first: it reaches through the
          // renderer's extension registry, which dispose() tears down.
          renderer.forceContextLoss();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [points]);

  // Keep the host mounted under an error overlay so a subsequent effect can
  // still find it and clear the failure.
  return (
    <div className={cn("relative h-full w-full", className)}>
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-xs text-destructive">
          Could not render point cloud: {error}
        </div>
      ) : null}
      <div
        ref={hostRef}
        data-testid="point-cloud-view"
        className={cn(
          "h-full w-full cursor-grab active:cursor-grabbing",
          error && "invisible",
        )}
      />
    </div>
  );
}
