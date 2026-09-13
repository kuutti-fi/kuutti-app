import { afterAll } from "vitest";
import { closeTestPool } from "./harness.ts";

afterAll(async () => {
  await closeTestPool();
});
