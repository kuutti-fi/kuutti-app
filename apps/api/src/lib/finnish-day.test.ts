import { describe, expect, it } from "vitest";
import { finnishDay } from "./finnish-day.ts";

describe("finnishDay", () => {
  it("names the day in Finland, not the server's", () => {
    // 22:30 UTC is already the next day in Helsinki, summer and winter.
    expect(finnishDay(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(finnishDay(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    expect(finnishDay(new Date("2026-09-27T12:00:00Z"))).toBe("2026-09-27");
    // Winter time is UTC+2: 21:30 UTC is still the same day.
    expect(finnishDay(new Date("2026-12-31T21:30:00Z"))).toBe("2026-12-31");
  });
});
