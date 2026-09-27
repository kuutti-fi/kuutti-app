-- Custom SQL migration file, put your code below! --
-- matching_config version 1 row for the waitlist counter (#54, ADR-013): the
-- threshold below which the public counter says no number (rules/schema.md:
-- gender counts are suppressed below k). The code holds a floor of 10 under
-- it (WAITLIST_K_MIN in packages/schema): a row may raise k, never lower it.
-- The seed carries the same row (packages/db/src/seed.ts; migrate.test.ts
-- keeps the two identical). A new number is a new version, never an edit of
-- this file.
INSERT INTO "matching_config" ("version", "key", "value", "created_by") VALUES
  (1, 'waitlist_k', '10'::jsonb, 'migration:0017')
ON CONFLICT ("key", "version") DO NOTHING;
