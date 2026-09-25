import {
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { account } from "./identity.ts";

/**
 * A photo row is the account's; the object behind it is shared (#48, TD-2,
 * TD-8). `key` is the SHA-256 of the re-encoded full variant, so the same
 * picture uploaded twice, by the same person or by two accounts, is one set
 * of objects in the bucket and two rows here. No original is ever stored
 * (rule 4), so nothing here points at one. Width and height are the full
 * variant's; the blurhash is computed from the thumb and lets the app paint
 * before the bytes arrive.
 */
export const photoState = pgEnum("photo_state", ["pending", "approved", "queued", "rejected"]);
export const photoVariant = pgEnum("photo_variant", ["thumb", "card", "full"]);

export const photo = pgTable(
  "photo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    // Content address: hex SHA-256 of the full variant. Objects live under
    // media/<key>/<variant>.webp and are removed when the last row goes.
    key: text("key").notNull(),
    blurhash: text("blurhash").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // pending until moderation (#49) says otherwise; the owner sees it, nobody else.
    state: photoState("state").notNull().default("pending"),
    // 0 is the main photo. The owner orders; the API renumbers 0..n-1.
    position: smallint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("photo_account_position_idx").on(table.accountId, table.position),
    index("photo_key_idx").on(table.key),
  ],
);

/**
 * One row per signed URL issued (rules/api.md Media, security checklist
 * "Signed URL issuance is logged per account"). This is the fetch log the
 * exposure budget of TD-6 counts from (#52), and what makes a leak
 * attributable: with bank-verified accounts, to a person. `photo_id` has no
 * foreign key on purpose: the log outlives the photo it names.
 */
export const photoAccess = pgTable(
  "photo_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    photoId: uuid("photo_id").notNull(),
    variant: photoVariant("variant").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The budget is counted per account per day (#52); the same index serves it.
  (table) => [index("photo_access_account_at_idx").on(table.accountId, table.at)],
);

export type Photo = typeof photo.$inferSelect;
export type NewPhoto = typeof photo.$inferInsert;
export type PhotoState = Photo["state"];
export type PhotoAccess = typeof photoAccess.$inferSelect;
export type NewPhotoAccess = typeof photoAccess.$inferInsert;
