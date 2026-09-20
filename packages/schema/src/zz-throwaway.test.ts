// THROWAWAY, never merge: proves the guards of #8 turn red (one defect per check).
import { expect, it } from "vitest";

// typecheck: a string is not a number.
const notANumber: number = "five";

it("fails on purpose", () => {
  // lint: Biome's noDebugger.
  debugger;
  // test-api-packages: a failing assertion.
  expect(notANumber).toBe(5);
});
