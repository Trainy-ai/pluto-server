/**
 * Seed the two "best-step tolerance" fixture runs in the user's local dev
 * database (org `ryandevvm`, project `my-ml-project`). Non-destructive:
 * only touches the two fixture runs by name. Used to visually verify the
 * nearest-snap + K-tolerance feature.
 *
 * Run from inside the backend container so MinIO / ClickHouse hostnames
 * resolve correctly:
 *
 *   docker compose --env-file .env exec backend sh -c \
 *     "cd /app && node_modules/.bin/tsx /app/server/scripts/seed-tolerance-fixtures.ts"
 *
 * If DEV_ORG / DEV_PROJECT env vars are set they override the defaults.
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@clickhouse/client-web";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import zlib from "zlib";

const DEV_ORG_SLUG = process.env.DEV_ORG_SLUG || "ryandevvm";
const DEV_PROJECT = process.env.DEV_PROJECT || "my-ml-project";

const METRIC_LOG = "train/loss";
const IMAGE_LOG = "images/samples";

const OFFSET_RUN_NAME = "tol-test-run-offset";
const HARD_RUN_NAME = "tol-test-run-hard";

const prisma = new PrismaClient();

// Minimal 16×16 solid-color PNG. Copy-pasted from the existing seed scripts —
// the rendering details don't matter for this test fixture, we just need
// *any* valid image bytes per file so MinIO + the image viewer work.
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}
function solidPng(r: number, g: number, b: number): Buffer {
  const w = 16,
    h = 16;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push(r, g, b);
  }
  const idat = zlib.deflateSync(Buffer.from(raw));
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const storageEndpoint = process.env.STORAGE_ENDPOINT;
  const storageAccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const storageSecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const storageBucket = process.env.STORAGE_BUCKET;
  if (!clickhouseUrl || !storageEndpoint || !storageAccessKey || !storageSecretKey || !storageBucket) {
    console.error("Missing CLICKHOUSE_URL / STORAGE_* env vars");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({ where: { slug: DEV_ORG_SLUG } });
  if (!org) {
    console.error(`Organization '${DEV_ORG_SLUG}' not found`);
    process.exit(1);
  }
  const project = await prisma.projects.findUnique({
    where: { organizationId_name: { organizationId: org.id, name: DEV_PROJECT } },
  });
  if (!project) {
    console.error(`Project '${DEV_PROJECT}' not found`);
    process.exit(1);
  }

  // Runs require createdById + creatorApiKeyId; grab the first admin/owner
  // of this org and any of their API keys.
  const member = await prisma.member.findFirst({
    where: { organizationId: org.id },
    select: { userId: true },
  });
  if (!member) {
    console.error(`No member found for org ${DEV_ORG_SLUG}`);
    process.exit(1);
  }
  const apiKey = await prisma.apiKey.findFirst({
    where: { organizationId: org.id, userId: member.userId },
    select: { id: true },
  });
  if (!apiKey) {
    console.error(`No API key found for user ${member.userId} in org ${DEV_ORG_SLUG}`);
    process.exit(1);
  }

  // Find-or-create the two fixture runs.
  const baseCreatedAt = new Date();
  async function ensureRun(name: string) {
    const existing = await prisma.runs.findFirst({
      where: { organizationId: org!.id, projectId: project!.id, name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.runs.create({
      data: {
        name,
        organizationId: org!.id,
        projectId: project!.id,
        createdById: member!.userId,
        creatorApiKeyId: apiKey!.id,
        status: "COMPLETED",
        createdAt: baseCreatedAt,
        updatedAt: baseCreatedAt,
      },
      select: { id: true },
    });
    return created.id;
  }
  const offsetId = await ensureRun(OFFSET_RUN_NAME);
  const hardId = await ensureRun(HARD_RUN_NAME);
  console.log(`   offset run id = ${offsetId}, hard run id = ${hardId}`);

  // Register log names in PostgreSQL (so the run-logs query discovers them).
  await prisma.runLogs.createMany({
    data: [
      { runId: offsetId, logName: METRIC_LOG, logGroup: "train", logType: "METRIC" },
      { runId: offsetId, logName: IMAGE_LOG, logGroup: "images", logType: "IMAGE" },
      { runId: hardId, logName: METRIC_LOG, logGroup: "train", logType: "METRIC" },
      { runId: hardId, logName: IMAGE_LOG, logGroup: "images", logType: "IMAGE" },
    ],
    skipDuplicates: true,
  });

  // Normalize STORAGE_ENDPOINT for inside-container use (localhost → minio).
  const isDocker = process.env.IS_DOCKER === "true";
  let s3Endpoint = storageEndpoint;
  if (isDocker) {
    if (s3Endpoint.includes("localhost")) s3Endpoint = s3Endpoint.replace("localhost", "minio");
    if (s3Endpoint.includes("127.0.0.1")) s3Endpoint = s3Endpoint.replace("127.0.0.1", "minio");
  }
  const s3 = new S3Client({
    endpoint: s3Endpoint,
    region: process.env.STORAGE_REGION || "us-east-1",
    credentials: { accessKeyId: storageAccessKey, secretAccessKey: storageSecretKey },
    forcePathStyle: true,
  });
  const ch = createClient({
    url: clickhouseUrl,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  // Reset previous fixture rows so re-running the script produces a
  // deterministic result. Sync mutation so inserts after this return don't
  // race with the delete.
  const runIdList = [Number(offsetId), Number(hardId)].join(",");
  await ch.command({
    query: `ALTER TABLE mlop_metrics DELETE WHERE tenantId = '${org.id}' AND projectName = '${project.name}' AND runId IN (${runIdList}) AND logName = '${METRIC_LOG}' SETTINGS mutations_sync = 2`,
  });
  await ch.command({
    query: `ALTER TABLE mlop_files DELETE WHERE tenantId = '${org.id}' AND projectName = '${project.name}' AND runId IN (${runIdList}) AND logName = '${IMAGE_LOG}' SETTINGS mutations_sync = 2`,
  });

  const baseTime = new Date("2025-01-01T00:00:00Z").getTime();
  const toIsoCh = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

  const metricRows: Record<string, unknown>[] = [];
  const fileRows: Record<string, unknown>[] = [];
  const uploads: Promise<unknown>[] = [];

  // -- Offset-cadence fixture: metric at {0,10,...,100}, parabola min at 50 (val 0.1).
  // -- Image at {5,15,...,95}. Never overlap, always dist 5 from each other.
  for (let s = 0; s <= 100; s += 10) {
    metricRows.push({
      tenantId: org.id,
      projectName: project.name,
      runId: Number(offsetId),
      logGroup: "train",
      logName: METRIC_LOG,
      time: toIsoCh(baseTime + s * 1000),
      step: s,
      value: 0.1 + Math.pow(s - 50, 2) / 1000,
    });
  }
  for (let s = 5; s < 100; s += 10) {
    const fileName = `offset_step_${String(s).padStart(4, "0")}.png`;
    const png = solidPng((s * 2) % 256, 80, 120);
    fileRows.push({
      tenantId: org.id,
      projectName: project.name,
      runId: Number(offsetId),
      logGroup: "images",
      logName: IMAGE_LOG,
      time: toIsoCh(baseTime + s * 1000),
      step: s,
      fileName,
      fileType: "image/png",
      fileSize: png.length,
    });
    uploads.push(
      s3.send(
        new PutObjectCommand({
          Bucket: storageBucket,
          Key: `${org.id}/${project.name}/${offsetId}/${IMAGE_LOG}/${fileName}`,
          Body: png,
          ContentType: "image/png",
        }),
      ),
    );
  }

  // -- Hard fixture: metric argmin at step 500 far from any image; second-
  // -- smallest at 1002 right next to image 1001/1003. Default K=20 should
  // -- filter the true argmin out.
  const hardMetric: [number, number][] = [
    [200, 0.5],
    [500, 0.01], // true argmin but 500 away from any image
    [800, 0.4],
    [1002, 0.02], // 2nd smallest, dist 1 to image 1001/1003
  ];
  for (const [s, v] of hardMetric) {
    metricRows.push({
      tenantId: org.id,
      projectName: project.name,
      runId: Number(hardId),
      logGroup: "train",
      logName: METRIC_LOG,
      time: toIsoCh(baseTime + s * 1000),
      step: s,
      value: v,
    });
  }
  const hardImages = [0, 1000, 1001, 1003];
  for (const s of hardImages) {
    const fileName = `hard_step_${String(s).padStart(4, "0")}.png`;
    const png = solidPng((s * 7) % 256, 120, 80);
    fileRows.push({
      tenantId: org.id,
      projectName: project.name,
      runId: Number(hardId),
      logGroup: "images",
      logName: IMAGE_LOG,
      time: toIsoCh(baseTime + s * 1000),
      step: s,
      fileName,
      fileType: "image/png",
      fileSize: png.length,
    });
    uploads.push(
      s3.send(
        new PutObjectCommand({
          Bucket: storageBucket,
          Key: `${org.id}/${project.name}/${hardId}/${IMAGE_LOG}/${fileName}`,
          Body: png,
          ContentType: "image/png",
        }),
      ),
    );
  }

  await ch.insert({
    table: "mlop_metrics",
    values: metricRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
  });
  await ch.insert({
    table: "mlop_files",
    values: fileRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
  });
  await Promise.all(uploads);
  await ch.close();

  console.log(`   ✓ Inserted ${metricRows.length} metrics + ${fileRows.length} images`);
  console.log("   ✓ tolerance fixtures seeded");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
