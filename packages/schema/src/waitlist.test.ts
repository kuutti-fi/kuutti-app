import { describe, expect, it } from "vitest";
import {
  moveFigures,
  publishCounts,
  WAITLIST_K_MIN,
  type WaitlistCounts,
  WaitlistResponse,
  waitlistK,
} from "./waitlist.ts";

// The rules of the waitlist counter (#54, ADR-013): what may be said, and when
// what is said may move.

const counts = (over: Partial<WaitlistCounts>): WaitlistCounts => ({
  verified: 0,
  woman: 0,
  man: 0,
  nonBinary: 0,
  finishing: 0,
  ...over,
});

const NOTHING = { verified: null, split: null, finishing: null };

describe("publishCounts", () => {
  it("says nothing about a pond below k, not even a part of it", () => {
    for (const verified of [0, 1, 9]) {
      expect(publishCounts(counts({ verified, woman: verified, finishing: verified }), 10)).toEqual(
        NOTHING,
      );
    }
    expect(publishCounts(null, 10)).toEqual(NOTHING);
  });

  it("publishes the split when every cell is at least k", () => {
    expect(
      publishCounts(counts({ verified: 75, woman: 40, man: 25, nonBinary: 10, finishing: 12 }), 10),
    ).toEqual({ verified: 75, split: { woman: 40, man: 25, nonBinary: 10 }, finishing: 12 });
  });

  it("hides the whole split for one small cell, because the third would be a subtraction", () => {
    const published = publishCounts(
      counts({ verified: 78, woman: 40, man: 35, nonBinary: 3, finishing: 12 }),
      10,
    );
    expect(published).toEqual({ verified: 78, split: null, finishing: 12 });
    // Nothing in what is published lets 3 be computed.
    expect(JSON.stringify(published)).not.toContain("35");
  });

  it("hides the split of a pond where a cell is empty: a zero says what nobody there declared", () => {
    // Everyone here declared the same: the split would say it of each of them.
    expect(publishCounts(counts({ verified: 12, woman: 12 }), 10).split).toBeNull();
    // Nobody here declared non-binary: the split would say that of each of them.
    expect(publishCounts(counts({ verified: 25, woman: 13, man: 12 }), 10).split).toBeNull();
  });

  it("hides the split when the people without a declared gender are a small remainder", () => {
    const cells = { woman: 12, man: 11, nonBinary: 10 };
    expect(publishCounts(counts({ verified: 33, ...cells }), 10).split).toEqual(cells);
    expect(publishCounts(counts({ verified: 40, ...cells }), 10).split).toBeNull(); // 7 undeclared
    expect(publishCounts(counts({ verified: 43, ...cells }), 10).split).toEqual(cells);
  });

  it("says how many are finishing only when they and the rest are none or at least k", () => {
    const finishing = (verified: number, n: number) =>
      publishCounts(counts({ verified, finishing: n }), 10).finishing;
    expect(finishing(25, 15)).toBe(15);
    expect(finishing(25, 0)).toBe(0);
    expect(finishing(25, 25)).toBe(25);
    expect(finishing(25, 1)).toBeNull();
    expect(finishing(25, 24)).toBeNull(); // one complete profile
    expect(finishing(12, 9)).toBeNull();
    // The total stands whatever happens to the part.
    expect(publishCounts(counts({ verified: 12, finishing: 9 }), 10).verified).toBe(12);
  });

  it("follows a k above the floor", () => {
    const pond = counts({ verified: 45, woman: 15, man: 15, nonBinary: 15 });
    expect(publishCounts(pond, 10).split).not.toBeNull();
    expect(publishCounts(pond, 20)).toEqual({ verified: 45, split: null, finishing: 0 });
    expect(publishCounts(pond, 50)).toEqual(NOTHING);
  });

  it("publishes nothing for a k below the floor, whatever the configuration says", () => {
    const pond = counts({ verified: 45, woman: 15, man: 15, nonBinary: 15 });
    for (const k of [9, 5, 1, 0, -1, 10.5, Number.NaN]) {
      expect(publishCounts(pond, k)).toEqual(NOTHING);
    }
    expect(WAITLIST_K_MIN).toBe(10);
    expect(waitlistK(1)).toBe(10);
    expect(waitlistK(10)).toBe(10);
    expect(waitlistK(25)).toBe(25);
    expect(waitlistK(Number.NaN)).toBe(10);
    expect(waitlistK(Number.POSITIVE_INFINITY)).toBe(10);
    // A fraction is rounded up, the side that says less.
    expect(waitlistK(12.5)).toBe(13);
    expect(waitlistK(10.1)).toBe(11);
    expect(waitlistK(9.9)).toBe(10);
  });

  it("fails closed on counts that cannot be", () => {
    expect(publishCounts(counts({ verified: 20, finishing: 21 }), 10)).toEqual(NOTHING);
    expect(publishCounts(counts({ verified: 20, woman: 15, man: 15 }), 10)).toEqual(NOTHING);
    expect(publishCounts(counts({ verified: 20, woman: -1 }), 10)).toEqual(NOTHING);
    expect(publishCounts(counts({ verified: 20.5 }), 10)).toEqual(NOTHING);
  });
});

describe("moveFigures", () => {
  const standing = counts({ verified: 35, woman: 13, man: 12, nonBinary: 10, finishing: 20 });

  it("takes the first count as it is", () => {
    const today = counts({ verified: 3, woman: 3 });
    expect(moveFigures(null, today, 10)).toBe(today);
  });

  it("replaces figures under the floor, which were never said, every time", () => {
    const small = counts({ verified: 8, woman: 8 });
    const today = counts({ verified: 9, woman: 9 });
    expect(moveFigures(small, today, 10)).toBe(today);
    expect(moveFigures(small, today, 50)).toBe(today);
  });

  it("keeps figures that were said under k = 10 standing while k is raised, and says them again unchanged", () => {
    const said = counts({ verified: 45, woman: 15, man: 15, nonBinary: 15 });
    const before = publishCounts(said, 10);
    // k is raised to 50: nothing is said of the pond, and one woman joins.
    const joined = counts({ ...said, verified: 46, woman: 16 });
    const held = moveFigures(said, joined, 50);
    expect(held).toBe(said);
    expect(publishCounts(held, 50)).toEqual(NOTHING);
    // k returns to 10: what is said is what was said, not the pond a person later.
    expect(publishCounts(moveFigures(held, joined, 10), 10)).toEqual(before);
  });

  it("never steps by less than the floor, whatever k it is given", () => {
    const next = counts({ ...standing, verified: 36, woman: 14 });
    for (const k of [1, 0, -5, 9]) expect(moveFigures(standing, next, k)).toBe(standing);
  });

  it("stands still while fewer than k people have come or gone", () => {
    for (const verified of [26, 34, 36, 44]) {
      const today = counts({ ...standing, verified, woman: standing.woman + verified - 35 });
      expect(moveFigures(standing, today, 10)).toBe(standing);
    }
  });

  it("moves, total and cells together, once the total has moved by k", () => {
    const grown = counts({ verified: 45, woman: 22, man: 13, nonBinary: 10, finishing: 21 });
    expect(moveFigures(standing, grown, 10)).toBe(grown);
    const shrunk = counts({ verified: 25, woman: 8, man: 9, nonBinary: 8, finishing: 12 });
    expect(moveFigures(standing, shrunk, 10)).toBe(shrunk);
  });

  it("never shows one arrival: a day's difference of one changes nothing that is published", () => {
    const next = counts({ ...standing, verified: 36, woman: 14 });
    const before = publishCounts(moveFigures(null, standing, 10), 10);
    const after = publishCounts(moveFigures(standing, next, 10), 10);
    expect(after).toEqual(before);
  });

  it("does not show a cell falling under k by one departure", () => {
    const next = counts({ ...standing, verified: 34, nonBinary: 9 });
    expect(publishCounts(moveFigures(standing, next, 10), 10).split).toEqual({
      woman: 13,
      man: 12,
      nonBinary: 10,
    });
  });

  it("moves the people finishing only with the total, however far they have moved", () => {
    const today = counts({ ...standing, verified: 37, woman: 15, finishing: 8 });
    expect(moveFigures(standing, today, 10)).toBe(standing);
  });

  it("never says two states a day and one person apart", () => {
    // Thirty people finish their profiles while nine join, then one more joins.
    const night1 = counts({ verified: 50, woman: 20, man: 20, nonBinary: 10, finishing: 50 });
    const night2 = counts({ ...night1, verified: 59, woman: 29, finishing: 30 });
    const night3 = counts({ ...night2, verified: 60, woman: 30, finishing: 31 });
    const said1 = moveFigures(null, night1, 10);
    const said2 = moveFigures(said1, night2, 10);
    const said3 = moveFigures(said2, night3, 10);
    expect(said2).toBe(night1);
    expect(said3).toBe(night3);
    expect(said3.verified - said2.verified).toBeGreaterThanOrEqual(10);
  });

  it("returns the standing figures themselves when the count is the same", () => {
    expect(moveFigures(standing, { ...standing }, 10)).toBe(standing);
  });
});

describe("the response", () => {
  const pond = {
    id: "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01",
    slug: "otaniemi",
    name: "Otaniemi",
    nameInessive: "Otaniemessä",
    parentId: null,
  };
  const hidden = { pond, day: null, verified: null, split: null, finishing: null };

  it("carries a day, never a time, and no id but the pond's", () => {
    const parsed = WaitlistResponse.parse({
      k: 10,
      ponds: [hidden, { ...hidden, day: "2026-09-27", verified: 25, finishing: 0 }],
    });
    expect(parsed.ponds).toHaveLength(2);
    expect(
      WaitlistResponse.safeParse({ k: 10, ponds: [{ ...hidden, day: "2026-09-27T04:00:00Z" }] })
        .success,
    ).toBe(false);
    expect(WaitlistResponse.safeParse({ ...parsed, takenAt: "x" }).success).toBe(false);
  });

  it("cannot carry a number under the floor, or a k under it", () => {
    expect(WaitlistResponse.safeParse({ k: 9, ponds: [] }).success).toBe(false);
    expect(WaitlistResponse.safeParse({ k: 10, ponds: [{ ...hidden, verified: 9 }] }).success).toBe(
      false,
    );
    expect(
      WaitlistResponse.safeParse({
        k: 10,
        ponds: [{ ...hidden, verified: 25, split: { woman: 13, man: 12, nonBinary: 0 } }],
      }).success,
    ).toBe(false);
    const finishing = (n: number) =>
      WaitlistResponse.safeParse({ k: 10, ponds: [{ ...hidden, verified: 25, finishing: n }] })
        .success;
    expect(finishing(0)).toBe(true);
    expect(finishing(10)).toBe(true);
    for (const n of [1, 9, -1, 10.5]) expect(finishing(n)).toBe(false);
  });
});
