-- Custom SQL migration file, put your code below! --
-- matching_config version 1 for a deployed database (#48, #49): the seed
-- carries the same rows for previews and local development, but production
-- is never seeded (TD-19) and staging only by hand, and a key the API reads
-- and does not find is a 500. Values are the decisions log's defaults, the
-- ones packages/db/src/seed.ts holds (a test keeps the two identical); a new
-- number is a new version, never an edit of this file.
INSERT INTO "matching_config" ("version", "key", "value", "created_by") VALUES
  (1, 'gate_k', '30'::jsonb, 'migration:0007'),
  (1, 'majority_share_max', '0.6'::jsonb, 'migration:0007'),
  (1, 'round_size', '12'::jsonb, 'migration:0007'),
  (1, 'impression_cap_per_day', '40'::jsonb, 'migration:0007'),
  (1, 'like_budget_balanced', '12'::jsonb, 'migration:0007'),
  (1, 'like_budget_contested', '5'::jsonb, 'migration:0007'),
  (1, 'contest_ratio_threshold', '1.5'::jsonb, 'migration:0007'),
  (1, 'liked_you_cap', '10'::jsonb, 'migration:0007'),
  (1, 'like_expiry_days', '14'::jsonb, 'migration:0007'),
  (1, 'pass_cooldown_days', '90'::jsonb, 'migration:0007'),
  (1, 'shown_cooldown_days', '30'::jsonb, 'migration:0007'),
  (1, 'silent_match_archive_days', '7'::jsonb, 'migration:0007'),
  (1, 'max_photos', '6'::jsonb, 'migration:0007'),
  (1, 'photo_moderation_label_threshold', '60'::jsonb, 'migration:0007'),
  (1, 'photo_moderation_face_threshold', '90'::jsonb, 'migration:0007')
ON CONFLICT ("key", "version") DO NOTHING;
