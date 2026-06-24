import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env"; // Import the validated env
import { getCached, setCached, buildCacheKey } from "./cache";

// Initialize S3 client for Cloudflare R2 / MinIO / S3.
//
// `forcePathStyle: true` is required for MinIO (and any non-AWS S3 with a
// hostname-style endpoint like `http://minio:9000`). The SDK defaults to
// virtual-host-style — `https://bucket.minio:9000/key` — which DNS can't
// resolve inside the CI docker network because `bucket.minio` isn't a real
// host. Path-style produces `http://minio:9000/bucket/key`, which the
// browser CAN reach via Docker's service-name resolution. R2 accepts both
// styles, so this is safe everywhere.
//
// The seeders in `tests/setup.ts` already pass `forcePathStyle: true` to
// their own S3 clients — symptom of the runtime client missing it was that
// objects WROTE fine during seed but the presigned URLs returned from the
// backend at request time were signed for `bucket.minio:9000`, and chromium
// in the playwright container couldn't load them. Images rendered as broken
// in every CI test video.
const s3Client = new S3Client({
  region: env.STORAGE_REGION,
  endpoint: env.STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
});

// Read-through memo TTL for presigned URLs. The underlying URL is valid for
// expiresIn (5d default) so 24h leaves > 4d of headroom for clock skew, stale
// tabs, and in-flight requests — a returned URL is always good for ≥ 4 days.
// Without this memo the SigV4 signer stamps a fresh X-Amz-Date / X-Amz-Signature
// on every call, busting the browser HTTP cache on refetch / carousel / auto-
// refresh and forcing redownloads of identical bytes.
const PRESIGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Endpoint hashing keeps the key compact and invalidates the cache cleanly if
// a deployment switches storage backend (S3 ↔ R2 ↔ MinIO). The hash is not
// security-sensitive (it's just a key-compaction hash), but we use SHA-256 to
// avoid SHA-1 warnings from security scanners.
const endpointHash = createHash("sha256")
  .update(env.STORAGE_ENDPOINT)
  .digest("hex");

/**
 * Generates a presigned URL for viewing an R2 image
 * @param key - The object key (path) in the bucket
 * @param expiresIn - URL expiration time in seconds (default: 5 days)
 * @returns Promise<string> - The presigned URL
 */
async function getS3Url(
  key: string,
  expiresIn: number = 3600 * 24 * 5
): Promise<string> {
  const cacheKey = buildCacheKey("presign", {
    endpoint: endpointHash,
    bucket: env.STORAGE_BUCKET,
    key,
    expires: expiresIn,
  });
  const cached = await getCached<string>(cacheKey);
  if (cached) return cached;

  let signedUrl: string;
  try {
    const command = new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
    });

    signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expiresIn,
    });
  } catch (error) {
    console.error("Error generating R2 presigned URL:", error);
    throw new Error("Failed to generate R2 image URL");
  }

  // Fire-and-forget memo write. A cache-layer failure (e.g. transient
  // getRedisClient rejection) must not discard the already-valid URL nor be
  // misattributed to URL generation by the catch above.
  setCached(cacheKey, signedUrl, PRESIGN_CACHE_TTL_MS).catch((err) => {
    console.warn("[s3] Failed to memoize presigned URL:", err);
  });
  return signedUrl;
}

export const getImageUrl = async (
  tenantId: string,
  projectName: string,
  runId: number,
  logName: string,
  fileName: string
) => {
  const key = `${tenantId}/${projectName}/${runId}/${logName}/${fileName}`;
  return await getS3Url(key);
};

export async function uploadFileToR2(
  key: string,
  buffer: Buffer
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: env.STORAGE_BUCKET,
    Key: key,
    Body: buffer,
  });

  try {
    await s3Client.send(command);
  } catch (error) {
    console.error("Error uploading file to R2:", error);
    throw new Error("Failed to upload file to R2");
  }
}
