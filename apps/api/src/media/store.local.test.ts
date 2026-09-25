import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createS3Client } from "../lib/s3.ts";
import { testConfig } from "../test/harness.ts";
import { fixtureWebp } from "../test/media.ts";
import { objectKey, s3MediaStore } from "./store.ts";
import { presignedS3Signer, URL_TTL_MS } from "./urls.ts";

// The S3 store and the development signer against the S3 stand-in from docker compose,
// when S3_ENDPOINT is set (CI's compose job, or a developer with the stack
// up); skipped otherwise. Never a mocked store here: the memory store serves
// the route tests, this proves the real client and the presigned GET.
const endpoint = process.env.S3_ENDPOINT;

describe.skipIf(!endpoint)("media store (compose stand-in)", () => {
  const config = testConfig({
    S3_ENDPOINT: endpoint,
    S3_BUCKET: process.env.S3_BUCKET ?? "kuutti-media",
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "kuutti",
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "kuutti-dev-only",
    S3_FORCE_PATH_STYLE: "true",
  });

  it("puts the variants, reads them back, presigns a GET that fetch can open, and deletes them", async () => {
    const client = createS3Client(config);
    const store = s3MediaStore(client, config.S3_BUCKET);
    const signer = presignedS3Signer(client, config.S3_BUCKET);
    const key = `test-${randomBytes(6).toString("hex")}`;
    const bytes = await fixtureWebp(64, 48);
    try {
      await store.put(objectKey(key, "thumb"), bytes, "image/webp");
      expect(Buffer.from((await store.get(objectKey(key, "thumb"))) ?? [])).toEqual(bytes);
      expect(await store.get(objectKey(key, "card"))).toBeNull();

      const url = await signer.sign(objectKey(key, "thumb"), new Date(Date.now() + URL_TTL_MS));
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);

      // Without the signature the object is not public.
      const bare = new URL(url);
      bare.search = "";
      expect((await fetch(bare)).status).toBe(403);
    } finally {
      await store.delete([objectKey(key, "thumb")]);
      expect(await store.get(objectKey(key, "thumb"))).toBeNull();
      client.destroy();
    }
  });
});
