import { S3Client } from "@aws-sdk/client-s3";
import { createPool } from "@supportdesk/database";
import { cleanupUnusedUploads } from "./cleanup.js";

// Entry point for the daily scheduled ECS task.
const db = createPool();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" });
const olderThanDays = Number(process.env.CLEANUP_AFTER_DAYS ?? 60);
try {
  const deleted = await cleanupUnusedUploads({ db, s3, bucket: process.env.ATTACHMENTS_BUCKET ?? "supportdesk-local", olderThanDays });
  console.log(JSON.stringify({ msg: "unused uploads cleaned up", olderThanDays, deleted }));
} catch (error) {
  console.error(JSON.stringify({ msg: "upload cleanup failed", error: (error as Error).message }));
  process.exitCode = 1;
} finally {
  await db.end();
}
