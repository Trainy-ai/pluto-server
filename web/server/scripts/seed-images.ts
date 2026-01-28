/**
 * Seed development data with sample images for testing the media widget.
 * This script creates placeholder images in MinIO and registers them in ClickHouse.
 *
 * Usage:
 *   pnpm seed:images        - Seed using .env.locals (local development)
 *   pnpm seed:images:docker - Seed using .env (Docker Compose) with MinIO service endpoint
 *
 * When running inside Docker, use seed:images:docker which sets STORAGE_ENDPOINT=http://minio:9000
 * to connect to the MinIO service container instead of localhost.
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@clickhouse/client-web';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import zlib from 'zlib';

// Simple CRC32 implementation for PNG
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const prisma = new PrismaClient();

const DEV_ORG_SLUG = 'dev-org';
const DEV_PROJECT = 'my-ml-project';

// Image seeding configuration
// Use path-style naming: logGroup/logName so that getLogGroupName() can derive the group
// e.g., 'media/training_samples' -> logGroup='media', logName='training_samples'
const IMAGE_LOG_GROUP = 'media';
const IMAGE_LOG_NAME = 'training_samples';
const IMAGE_LOG_FULL_NAME = `${IMAGE_LOG_GROUP}/${IMAGE_LOG_NAME}`;
const STEPS_WITH_IMAGES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const RUNS_TO_SEED = 5; // Seed images for first 5 runs

/**
 * Creates a simple PNG image as a Buffer.
 * Generates a colored square based on step and run index.
 */
function createSimplePNG(width: number, height: number, r: number, g: number, b: number): Buffer {
  // Create a simple uncompressed PNG
  // This is a minimal PNG file with a single color

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = createPNGChunk('IHDR', ihdrData);

  // IDAT chunk (image data)
  // Create raw image data (filter byte + RGB for each pixel per row)
  const rawData: number[] = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }

  // Compress with zlib
  const compressedData = zlib.deflateSync(Buffer.from(rawData));
  const idatChunk = createPNGChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createPNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');

  // CRC32 of type + data
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = crc32(crcData);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crcValue, 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * Generates a color based on step and run index for visual variety
 */
function getColorForStep(step: number, runIndex: number): { r: number; g: number; b: number } {
  // Use HSL-like distribution for nice colors
  const hue = (step * 3.6 + runIndex * 60) % 360;
  const saturation = 0.7;
  const lightness = 0.5;

  // Convert HSL to RGB
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

async function main() {
  console.log('Seeding image data for media widget testing...\n');

  // Get environment variables
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';

  if (!clickhouseUrl) {
    console.error('CLICKHOUSE_URL not set');
    process.exit(1);
  }

  let s3Endpoint = process.env.STORAGE_ENDPOINT;
  const s3AccessKey = process.env.STORAGE_ACCESS_KEY_ID;
  const s3SecretKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const s3Bucket = process.env.STORAGE_BUCKET;
  const s3Region = process.env.STORAGE_REGION || 'us-east-1';

  if (!s3Endpoint || !s3AccessKey || !s3SecretKey || !s3Bucket) {
    console.error('S3/MinIO environment variables not set');
    process.exit(1);
  }

  // When running inside Docker, replace localhost/127.0.0.1 with the minio service name
  const isDocker = process.env.IS_DOCKER === 'true';
  if (isDocker) {
    if (s3Endpoint.includes('localhost')) {
      s3Endpoint = s3Endpoint.replace('localhost', 'minio');
      console.log(`   Detected Docker environment, using MinIO at: ${s3Endpoint}`);
    } else if (s3Endpoint.includes('127.0.0.1')) {
      s3Endpoint = s3Endpoint.replace('127.0.0.1', 'minio');
      console.log(`   Detected Docker environment, using MinIO at: ${s3Endpoint}`);
    }
  }

  // Initialize clients
  const clickhouse = createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
  });

  const s3Client = new S3Client({
    region: s3Region,
    endpoint: s3Endpoint,
    credentials: {
      accessKeyId: s3AccessKey,
      secretAccessKey: s3SecretKey,
    },
    forcePathStyle: true, // Required for MinIO
  });

  // 1. Get organization
  console.log('1. Finding organization...');
  const org = await prisma.organization.findUnique({ where: { slug: DEV_ORG_SLUG } });
  if (!org) {
    console.error(`Organization '${DEV_ORG_SLUG}' not found. Run seed-dev.ts first.`);
    process.exit(1);
  }
  console.log(`   Found org: ${org.name}`);

  // 2. Get project
  console.log('\n2. Finding project...');
  const project = await prisma.projects.findUnique({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: DEV_PROJECT,
      },
    },
  });
  if (!project) {
    console.error(`Project '${DEV_PROJECT}' not found. Run seed-dev.ts first.`);
    process.exit(1);
  }
  console.log(`   Found project: ${project.name}`);

  // 3. Get runs to seed images for
  console.log(`\n3. Getting first ${RUNS_TO_SEED} runs...`);
  const runs = await prisma.runs.findMany({
    where: { projectId: project.id, organizationId: org.id },
    orderBy: { createdAt: 'desc' },
    take: RUNS_TO_SEED,
    select: { id: true, name: true },
  });

  if (runs.length === 0) {
    console.error('No runs found. Run seed-dev.ts first.');
    process.exit(1);
  }
  console.log(`   Found ${runs.length} runs`);

  // 4. Register image log in PostgreSQL
  console.log('\n4. Registering image logs in PostgreSQL...');
  for (const run of runs) {
    await prisma.runLogs.upsert({
      where: {
        runId_logName: {
          runId: run.id,
          logName: IMAGE_LOG_FULL_NAME,
        },
      },
      update: {},
      create: {
        runId: run.id,
        logName: IMAGE_LOG_FULL_NAME,
        logGroup: IMAGE_LOG_GROUP,
        logType: 'IMAGE',
      },
    });
  }
  console.log(`   Registered '${IMAGE_LOG_FULL_NAME}' log for ${runs.length} runs`);

  // 5. Upload images to MinIO and insert records to ClickHouse
  console.log('\n5. Uploading images and inserting ClickHouse records...');

  const clickhouseRecords: Record<string, unknown>[] = [];
  let uploadCount = 0;

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    console.log(`   Processing run: ${run.name}`);

    for (const step of STEPS_WITH_IMAGES) {
      const fileName = `step_${String(step).padStart(5, '0')}.png`;
      const s3Key = `${org.id}/${project.name}/${run.id}/${IMAGE_LOG_FULL_NAME}/${fileName}`;

      // Generate colored image
      const color = getColorForStep(step, runIndex);
      const imageBuffer = createSimplePNG(64, 64, color.r, color.g, color.b);

      // Upload to MinIO
      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: s3Bucket,
          Key: s3Key,
          Body: imageBuffer,
          ContentType: 'image/png',
        }));
        uploadCount++;
      } catch (error) {
        console.error(`   Failed to upload ${s3Key}:`, error);
        continue;
      }

      // Prepare ClickHouse record
      const baseTime = Date.now() - (100 - step) * 60 * 1000; // Newer steps have more recent times
      clickhouseRecords.push({
        tenantId: org.id,
        projectName: project.name,
        runId: Number(run.id),
        logGroup: IMAGE_LOG_GROUP,
        logName: IMAGE_LOG_FULL_NAME,
        time: new Date(baseTime).toISOString().replace('T', ' ').replace('Z', ''),
        step,
        fileName,
        fileType: 'image/png',
        fileSize: imageBuffer.length,
      });
    }
  }

  console.log(`   Uploaded ${uploadCount} images to MinIO`);

  // 6. Insert records to ClickHouse
  console.log('\n6. Inserting records to ClickHouse...');
  if (clickhouseRecords.length > 0) {
    await clickhouse.insert({
      table: 'mlop_files',
      values: clickhouseRecords,
      format: 'JSONEachRow',
    });
    console.log(`   Inserted ${clickhouseRecords.length} file records`);
  }

  await clickhouse.close();

  console.log('\n' + '='.repeat(50));
  console.log('Image data seeded successfully!\n');
  console.log(`Created ${uploadCount} images across ${runs.length} runs`);
  console.log(`Log name: ${IMAGE_LOG_FULL_NAME}`);
  console.log(`Steps with images: ${STEPS_WITH_IMAGES.join(', ')}`);
  console.log('='.repeat(50) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during seeding:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
