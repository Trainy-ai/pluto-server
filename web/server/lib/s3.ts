import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
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
  // Static credentials are OPTIONAL. Passing `credentials` explicitly pins the
  // client to that key and bypasses the AWS SDK's default credential provider
  // chain entirely. Leaving it `undefined` lets the SDK resolve credentials
  // itself — which is how IRSA (EKS web identity, via AWS_ROLE_ARN +
  // AWS_WEB_IDENTITY_TOKEN_FILE) engages, with short-lived STS credentials that
  // rotate automatically instead of a long-lived static key.
  //
  // Behavior is unchanged when both vars ARE set: MinIO in CI and self-hosted
  // deployments simply keep setting STORAGE_ACCESS_KEY_ID /
  // STORAGE_SECRET_ACCESS_KEY and get the exact same explicit-credential client
  // as before.
  credentials:
    env.STORAGE_ACCESS_KEY_ID && env.STORAGE_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
        }
      : undefined,
});

// Read-through memo TTL for presigned URLs. The underlying URL is valid for
// expiresIn (5d default) so 24h leaves > 4d of headroom for clock skew, stale
// tabs, and in-flight requests — a returned URL is always good for ≥ 4 days.
// Without this memo the SigV4 signer stamps a fresh X-Amz-Date / X-Amz-Signature
// on every call, busting the browser HTTP cache on refetch / carousel / auto-
// refresh and forcing redownloads of identical bytes.
const PRESIGN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// CloudFront signing is all-or-nothing: a partial config is a deploy mistake,
// and silently falling back to S3 presigning would hide it, so fail at startup.
const cdnVars = {
  STORAGE_CDN_URL: env.STORAGE_CDN_URL,
  CLOUDFRONT_KEY_PAIR_ID: env.CLOUDFRONT_KEY_PAIR_ID,
  CLOUDFRONT_PRIVATE_KEY: env.CLOUDFRONT_PRIVATE_KEY,
};
const cdnVarsSet = Object.values(cdnVars).filter(Boolean).length;
if (cdnVarsSet !== 0 && cdnVarsSet !== 3) {
  const missing = Object.entries(cdnVars)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  throw new Error(
    `Incomplete CloudFront config: set all of STORAGE_CDN_URL, CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY or none (missing: ${missing.join(", ")})`
  );
}
const cdn =
  cdnVarsSet === 3
    ? {
        baseUrl: env.STORAGE_CDN_URL!.replace(/\/+$/, ""),
        keyPairId: env.CLOUDFRONT_KEY_PAIR_ID!,
        // Secrets injected via env often carry the PEM with literal "\n".
        privateKey: env.CLOUDFRONT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      }
    : null;

// The memo key identifies who signed the URL, so URLs from one signer are
// never served by a process using another: switching backend (S3 ↔ R2 ↔
// MinIO ↔ CloudFront) or credential source (static key vs. the default chain,
// i.e. IRSA) must not reuse cached URLs. That matters because prod and dev
// share a Redis: without this, dev on IRSA could serve prod's static-key URLs
// and mask expiry problems. Hashed for compactness only; SHA-256 avoids
// scanner warnings about SHA-1.
const signerHash = createHash("sha256")
  .update(
    cdn
      ? `cloudfront:${cdn.baseUrl}:${cdn.keyPairId}`
      : `s3:${env.STORAGE_ENDPOINT}:${env.STORAGE_ACCESS_KEY_ID ? "static" : "default-chain"}`
  )
  .digest("hex");

/**
 * Builds the CloudFront URL for an object key. Each path segment is
 * percent-encoded (spaces, '+', '#', '?', unicode in user file names);
 * CloudFront forwards the encoded path and S3 decodes it back to the key.
 */
export function cdnObjectUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Generates a signed download URL for an object: a CloudFront signed URL
 * when the CDN is configured, otherwise an S3 presigned URL.
 * @param key - The object key (path) in the bucket
 * @param expiresIn - URL expiration time in seconds (default: 5 days)
 * @returns Promise<string> - The signed URL
 */
async function getS3Url(
  key: string,
  expiresIn: number = 3600 * 24 * 5
): Promise<string> {
  const cacheKey = buildCacheKey("presign", {
    signer: signerHash,
    bucket: env.STORAGE_BUCKET,
    key,
    expires: expiresIn,
  });
  const cached = await getCached<string>(cacheKey);
  if (cached) return cached;

  let signedUrl: string;
  try {
    if (cdn) {
      // Canned policy: CloudFront's default cache policy ignores the query
      // string, so every signed variant of a URL shares one edge cache entry.
      signedUrl = getCloudFrontSignedUrl({
        url: cdnObjectUrl(cdn.baseUrl, key),
        keyPairId: cdn.keyPairId,
        privateKey: cdn.privateKey,
        dateLessThan: new Date(Date.now() + expiresIn * 1000).toISOString(),
      });
    } else {
      const command = new GetObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: key,
      });

      signedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: expiresIn,
      });
    }
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
