-- Custom SQL migration file, put your code below! --
-- matching_config version 1 rows for the exposure budget (#52, TD-6, ADR-008):
-- the seed carries the same rows (packages/db/src/seed.ts; migrate.test.ts
-- keeps the two identical). Cards an account may be served per day, and
-- signed photo URLs per variant per Finnish day, counted from photo_access in
-- the statement that writes it. A new number is a new version, never an edit.
INSERT INTO "matching_config" ("version", "key", "value", "created_by") VALUES
  (1, 'exposure_cards_per_day', '60'::jsonb, 'migration:0010'),
  (1, 'photo_fetches_per_day', '{"thumb": 600, "card": 300, "full": 60}'::jsonb, 'migration:0010')
ON CONFLICT ("key", "version") DO NOTHING;
