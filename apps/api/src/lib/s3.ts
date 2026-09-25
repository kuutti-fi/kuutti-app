import { S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config.ts";

/**
 * Object storage client. Locally the S3 stand-in from docker compose (path-style, static
 * keys from env.example); on AWS, S3 through the instance role with no keys at
 * all (TD-4). Uploads always go through the API (rule 4); reads use signed
 * CloudFront URLs (TD-8). The media slice (M3) builds on this.
 */
export function createS3Client(
  config: Pick<
    Config,
    "S3_ENDPOINT" | "S3_REGION" | "S3_ACCESS_KEY" | "S3_SECRET_KEY" | "S3_FORCE_PATH_STYLE"
  >,
): S3Client {
  const credentials =
    config.S3_ACCESS_KEY && config.S3_SECRET_KEY
      ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
      : undefined;
  return new S3Client({
    region: config.S3_REGION,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(credentials ? { credentials } : {}),
  });
}
