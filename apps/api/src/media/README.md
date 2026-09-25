# media

Photo upload, variants, signed URL issuance (#48, TD-2, TD-8, ADR-005). Moderation and the review queue arrive with #49, the exposure budget with #52.

- `pipeline.ts`: `inspectImage` reads format and size from the file header (the pixel cap applies before any decoder); `processPhoto` re-encodes with sharp into the three WebP variants, computes the content address and the blurhash. Nothing of the input survives it.
- `store.ts`: the object store behind `MediaStore` (S3 or MinIO through `lib/s3.ts`; a Map in tests). Only variants reach `put`.
- `urls.ts`: `UrlSigner`, CloudFront canned-policy URLs in deployed environments, presigned MinIO GETs in development.
- `repo.ts`: the rows, every statement scoped by `account_id` (rule 6). `photos.ts`: the service. `routes.ts`: the five routes. `wiring.ts`: what boot builds from the configuration.
- Tests: `pipeline.test.ts` on fixtures made at test time (`src/test/media.ts`), `urls.test.ts` verifies signatures with the public half, `routes.test.ts` runs every route through `app.request()` with a memory store, `store.minio.test.ts` runs against MinIO when `S3_ENDPOINT` is set (the compose job).
