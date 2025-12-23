import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env"; // Import the validated env

// Initialize S3 client for Cloudflare R2 bucket
const s3Client = new S3Client({
  region: env.STORAGE_REGION,
  endpoint: env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
});

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
  try {
    const command = new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expiresIn,
    });

    return signedUrl;
  } catch (error) {
    console.error("Error generating R2 presigned URL:", error);
    throw new Error("Failed to generate R2 image URL");
  }
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
