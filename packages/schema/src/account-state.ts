import { z } from "zod";

/** The account row's state; mirrors the database enum `account_state` (a test in apps/api keeps the two equal). */
export const AccountState = z.enum([
  "registered",
  "active",
  "paused",
  "shadow_banned",
  "suspended",
  "banned",
  "deleted",
]);
export type AccountState = z.infer<typeof AccountState>;
