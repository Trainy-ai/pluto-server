/**
 * Seed varied image sizes for verifying the image-widget PNG export with a
 * run+step caption strip. Each size lives under a different log name so the
 * user can add a widget per size and inspect how the caption renders against
 * tiny / wide / tall / huge images.
 *
 * Usage (inside the backend container):
 *   docker compose --env-file .env exec backend sh -c \
 *     "cd /app && pnpm exec tsx scripts/seed-image-sizes.ts"
 *
 * Targets the org / project named in TARGET_ORG_SLUG / TARGET_PROJECT below
 * (defaults to ryanh797's updatedSeededData). Picks the first 3 runs of that
 * project to spread images across so the run-slider has something to scrub.
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@clickhouse/client-web";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import zlib from "zlib";

const TARGET_ORG_SLUG = process.env.SEED_ORG_SLUG || "ryandevvm2";
const TARGET_PROJECT = process.env.SEED_PROJECT || "updatedSeededData";
const RUNS_PER_LOG = 3;
const STEPS_PER_RUN = [0, 25, 50, 75, 100];

/** Each entry becomes its own image widget. */
const SIZE_LOGS: Array<{ logName: string; w: number; h: number }> = [
  { logName: "image_sizes/tiny_32x32", w: 32, h: 32 },
  { logName: "image_sizes/small_128x128", w: 128, h: 128 },
  { logName: "image_sizes/wide_512x128", w: 512, h: 128 },
  { logName: "image_sizes/very_wide_1280x160", w: 1280, h: 160 },
  { logName: "image_sizes/tall_128x512", w: 128, h: 512 },
  { logName: "image_sizes/very_tall_160x1280", w: 160, h: 1280 },
  { logName: "image_sizes/medium_400x300", w: 400, h: 300 },
  { logName: "image_sizes/large_1024x768", w: 1024, h: 768 },
  { logName: "image_sizes/huge_2048x1024", w: 2048, h: 1024 },
  { logName: "image_sizes/huge_1024x2048", w: 1024, h: 2048 },
];

// ─── PNG generation ──────────────────────────────────────────────────────

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Generate a deterministic gradient PNG of the requested size. The hue is
 * driven by (runIdx, step) so each cell is visually distinct. Stripes mark
 * the boundaries so cropping issues in the export are visible at a glance.
 */
function generateGradientPNG(
  width: number,
  height: number,
  runIdx: number,
  step: number,
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const baseHue = ((runIdx * 73 + step * 11) % 360) / 360;

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      // Diagonal gradient + 5px stripes at each edge for cropping checks.
      const t = (x + y) / (width + height);
      const isEdge = x < 5 || y < 5 || x >= width - 5 || y >= height - 5;
      const isStripe = (Math.floor((x + y) / 12) & 1) === 0;
      let r: number, g: number, b: number;
      if (isEdge) {
        r = 240;
        g = 240;
        b = 240;
      } else {
        const hue = (baseHue + t * 0.4) % 1;
        // HSL → RGB (simple, lightness=0.5, saturation=0.7)
        [r, g, b] = hslToRgb(hue, 0.7, isStripe ? 0.55 : 0.45);
      }
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });
  const s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  const bucket = process.env.STORAGE_BUCKET!;

  console.log(`Targeting org="${TARGET_ORG_SLUG}" project="${TARGET_PROJECT}"`);

  const org = await prisma.organization.findUnique({ where: { slug: TARGET_ORG_SLUG } });
  if (!org) throw new Error(`Org "${TARGET_ORG_SLUG}" not found`);

  const project = await prisma.projects.findFirst({
    where: { organizationId: org.id, name: TARGET_PROJECT },
  });
  if (!project) throw new Error(`Project "${TARGET_PROJECT}" not found`);

  const runs = await prisma.runs.findMany({
    where: { organizationId: org.id, projectId: project.id },
    take: RUNS_PER_LOG,
    orderBy: { createdAt: "asc" },
  });
  if (runs.length === 0) throw new Error("No runs found in project");
  console.log(`Picked ${runs.length} runs: ${runs.map((r) => r.name).join(", ")}`);

  let totalUploaded = 0;
  const clickhouseRows: Record<string, unknown>[] = [];

  for (const sizeLog of SIZE_LOGS) {
    console.log(`\n[${sizeLog.logName}]  ${sizeLog.w}x${sizeLog.h}`);
    const logGroup = sizeLog.logName.split("/")[0];

    for (const run of runs) {
      await prisma.runLogs.upsert({
        where: { runId_logName: { runId: run.id, logName: sizeLog.logName } },
        update: {},
        create: { runId: run.id, logName: sizeLog.logName, logGroup, logType: "IMAGE" },
      });
    }

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      for (const step of STEPS_PER_RUN) {
        const fileName = `step_${String(step).padStart(5, "0")}.png`;
        const s3Key = `${org.id}/${project.name}/${run.id}/${sizeLog.logName}/${fileName}`;
        const png = generateGradientPNG(sizeLog.w, sizeLog.h, ri, step);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            Body: png,
            ContentType: "image/png",
          }),
        );
        totalUploaded++;
        const t = Date.now() - (100 - step) * 60 * 1000;
        clickhouseRows.push({
          tenantId: org.id,
          projectName: project.name,
          runId: Number(run.id),
          logGroup,
          logName: sizeLog.logName,
          time: new Date(t).toISOString().replace("T", " ").replace("Z", ""),
          step,
          fileName,
          fileType: "image/png",
          fileSize: png.length,
        });
      }
    }
  }

  console.log(`\nInserting ${clickhouseRows.length} rows into mlop_files...`);
  await clickhouse.insert({
    table: "mlop_files",
    values: clickhouseRows,
    format: "JSONEachRow",
  });
  await clickhouse.close();

  console.log(
    `\nDone. Uploaded ${totalUploaded} images across ${SIZE_LOGS.length} log names, ${runs.length} runs, ${STEPS_PER_RUN.length} steps each.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
