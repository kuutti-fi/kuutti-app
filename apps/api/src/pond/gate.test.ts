import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Applicant,
  admit,
  contestedGroup,
  joinsAGroupThatWaits,
  neededFrom,
  sayPlace,
  sayPool,
} from "./gate.ts";

// features/pond/gate.feature (#94, ADR-015): admission and what is said, as
// the pure rules they are. The count over a database is jobs/pond-gate.test.ts.

const T0 = Date.parse("2026-10-01T09:00:00Z");
let serial = 0;

/** People of one kind, each registered a minute after the one before. */
function group(
  count: number,
  gender: Applicant["gender"],
  seeks: Applicant["seeks"],
  options: { admitted?: boolean; from?: number } = {},
): Applicant[] {
  return Array.from({ length: count }, (_, i) => {
    serial += 1;
    return {
      id: `${gender}-${String(serial).padStart(4, "0")}`,
      gender,
      seeks,
      admitted: options.admitted ?? false,
      registeredAt: new Date(T0 + ((options.from ?? serial) + i) * 60_000),
    };
  });
}

describe("admission", () => {
  it("The smaller group is always let in, the larger while it is at most its share", () => {
    const inside = [
      ...group(6, "man", ["woman"], { admitted: true }),
      ...group(4, "woman", ["man"], { admitted: true }),
    ];
    // Seven of eleven would be over the share: both wait.
    const larger = group(2, "man", ["woman"], { from: 100 });
    expect(admit([...inside, ...larger], 0.6)).toEqual({
      admitted: [],
      waiting: new Map([
        [larger[0]?.id, 1],
        [larger[1]?.id, 2],
      ]),
    });
    // One of the smaller group is let in, and seven of twelve is inside the share.
    const smaller = group(1, "woman", ["man"], { from: 200 });
    const { admitted, waiting } = admit([...inside, ...larger, ...smaller], 0.6);
    expect(admitted).toEqual([larger[0]?.id, smaller[0]?.id]);
    expect([...waiting]).toEqual([[larger[1]?.id, 1]]);
  });

  it("A newcomer of the smaller group opens the way for those who waited", () => {
    const inside = group(3, "man", ["woman"], { admitted: true });
    const waited = group(2, "man", ["woman"], { from: 100 });
    // Three and three are equal, so the one who waited longest follows; five of eight would be over the share.
    const newcomers = group(3, "woman", ["man"], { from: 200 });
    const { admitted, waiting } = admit([...inside, ...waited, ...newcomers], 0.6);
    expect(admitted).toEqual([waited[0]?.id, ...newcomers.map((p) => p.id)]);
    expect([...waiting]).toEqual([[waited[1]?.id, 1]]);
  });

  it("People who seek their own gender, and non-binary people, never wait", () => {
    const inside = [
      ...group(9, "man", ["woman"], { admitted: true }),
      ...group(1, "woman", ["man"], { admitted: true }),
    ];
    const both = group(1, "man", ["woman", "man"], { from: 100 });
    const own = group(1, "man", ["man"], { from: 101 });
    const nonBinary = group(1, "non_binary", ["woman"], { from: 102 });
    const waits = group(1, "man", ["woman"], { from: 103 });
    const { admitted, waiting } = admit([...inside, ...both, ...own, ...nonBinary, ...waits], 0.6);
    expect(admitted).toEqual([both[0]?.id, own[0]?.id, nonBinary[0]?.id]);
    expect([...waiting.keys()]).toEqual([waits[0]?.id]);
    expect(contestedGroup(both[0] as Applicant)).toBeNull();
    expect(contestedGroup(nonBinary[0] as Applicant)).toBeNull();
    expect(contestedGroup(waits[0] as Applicant)).toBe("man");
  });

  it("Nobody is let out again when the pond drifts", () => {
    // Eight of one group and one of the other, all let in: far over the share, and it stays so.
    const inside = [
      ...group(8, "woman", ["man"], { admitted: true }),
      ...group(1, "man", ["woman"], { admitted: true }),
    ];
    const { admitted, waiting } = admit(inside, 0.6);
    expect(admitted).toEqual([]);
    expect(waiting.size).toBe(0);
  });

  it("an empty pond lets the first in, of whichever group, and the first of the other", () => {
    const first = group(1, "man", ["woman"], { from: 1 });
    const second = group(1, "man", ["woman"], { from: 2 });
    const other = group(1, "woman", ["man"], { from: 3 });
    expect(admit([...first, ...second], 0.6)).toEqual({
      admitted: [first[0]?.id],
      waiting: new Map([[second[0]?.id, 1]]),
    });
    // With one of the other group there, the two are equal and the second follows.
    expect(admit([...first, ...second, ...other], 0.6).admitted).toEqual([
      first[0]?.id,
      second[0]?.id,
      other[0]?.id,
    ]);
  });

  it("does the same for either group: the rule names no gender", () => {
    const swap = (people: Applicant[]): Applicant[] =>
      people.map((p) => ({
        ...p,
        id: `swapped-${p.id}`,
        gender: p.gender === "woman" ? "man" : p.gender === "man" ? "woman" : p.gender,
        seeks: p.seeks.map((g) => (g === "woman" ? "man" : g === "man" ? "woman" : g)),
      }));
    const people = [
      ...group(5, "man", ["woman"], { admitted: true }),
      ...group(3, "woman", ["man"], { admitted: true }),
      ...group(4, "man", ["woman"], { from: 100 }),
      ...group(2, "woman", ["man"], { from: 200 }),
    ];
    const one = admit(people, 0.6);
    const other = admit(swap(people), 0.6);
    expect(other.admitted).toEqual(one.admitted.map((id) => `swapped-${id}`));
    expect([...other.waiting]).toEqual([...one.waiting].map(([id, n]) => [`swapped-${id}`, n]));
  });

  const applicantsArb = fc
    .array(
      fc.record({
        gender: fc.constantFrom("woman", "man", "non_binary"),
        seeksOwn: fc.boolean(),
        admitted: fc.boolean(),
        minute: fc.integer({ min: 0, max: 10_000 }),
      }),
      { maxLength: 60 },
    )
    .map((drawn) =>
      drawn.map(
        (d, i): Applicant => ({
          id: `p-${String(i).padStart(3, "0")}`,
          gender: d.gender as Applicant["gender"],
          seeks:
            d.gender === "non_binary"
              ? ["woman", "man"]
              : d.seeksOwn
                ? [d.gender as "woman" | "man"]
                : [d.gender === "woman" ? "man" : "woman"],
          admitted: d.admitted,
          registeredAt: new Date(T0 + d.minute * 60_000),
        }),
      ),
    );

  it("for any pond: everybody is let in or waits, nobody twice, and nobody who was in is touched", () => {
    fc.assert(
      fc.property(applicantsArb, (people) => {
        const { admitted, waiting } = admit(people, 0.6);
        const fresh = people.filter((p) => !p.admitted).map((p) => p.id);
        expect([...admitted, ...waiting.keys()].sort()).toEqual(fresh.sort());
        expect(new Set(admitted).size).toBe(admitted.length);
      }),
    );
  });

  it("for any pond: within a group nobody is let in before somebody who registered earlier", () => {
    fc.assert(
      fc.property(applicantsArb, (people) => {
        const { admitted, waiting } = admit(people, 0.6);
        const byId = new Map(people.map((p) => [p.id, p]));
        for (const waits of waiting.keys()) {
          const w = byId.get(waits) as Applicant;
          for (const id of admitted) {
            const a = byId.get(id) as Applicant;
            if (contestedGroup(a) !== contestedGroup(w)) continue;
            expect(a.registeredAt.getTime()).toBeLessThanOrEqual(w.registeredAt.getTime());
          }
        }
      }),
    );
  });

  it("for any pond: counting again, with those let in now inside, lets nobody else in", () => {
    fc.assert(
      fc.property(applicantsArb, (people) => {
        const first = admit(people, 0.6);
        const now = new Set(first.admitted);
        const again = admit(
          people.map((p) => (now.has(p.id) ? { ...p, admitted: true } : p)),
          0.6,
        );
        expect(again.admitted).toEqual([]);
        expect([...again.waiting]).toEqual([...first.waiting]);
      }),
    );
  });

  it("for any pond: whoever waits would put their group over its share", () => {
    fc.assert(
      fc.property(applicantsArb, (people) => {
        const { admitted, waiting } = admit(people, 0.6);
        const inside = new Set([...people.filter((p) => p.admitted).map((p) => p.id), ...admitted]);
        const count = { woman: 0, man: 0 };
        for (const p of people) {
          const g = contestedGroup(p);
          if (g && inside.has(p.id)) count[g] += 1;
        }
        const byId = new Map(people.map((p) => [p.id, p]));
        for (const id of waiting.keys()) {
          const g = contestedGroup(byId.get(id) as Applicant);
          if (!g) throw new Error("somebody waits who waits with nobody");
          const other = g === "woman" ? "man" : "woman";
          expect(count[g]).toBeGreaterThan(count[other]);
          expect((count[g] + 1) / (count.woman + count.man + 1)).toBeGreaterThan(0.6);
        }
      }),
    );
  });
});

describe("what is said", () => {
  it("What a person is told is said in tens, and follows slowly", () => {
    // A pool of seventeen is said as ten: about twenty more are needed of thirty.
    expect(sayPool(null, 17, 10)).toBe(10);
    expect(neededFrom(10, 30)).toBe(20);
    // Two more come: nineteen is ten still.
    expect(sayPool(10, 19, 10)).toBe(10);
    // The twentieth makes it twenty, and about ten more are needed.
    expect(sayPool(10, 20, 10)).toBe(20);
    expect(neededFrom(sayPool(10, 20, 10), 30)).toBe(10);
    // One of them leaves again: a pool that goes back over the ten does not show it.
    expect(sayPool(20, 19, 10)).toBe(20);
    expect(sayPool(20, 11, 10)).toBe(20);
    // A whole step away, it follows.
    expect(sayPool(20, 10, 10)).toBe(10);
    expect(sayPool(20, 3, 10)).toBe(0);
  });

  it("The place in the line is said in tens", () => {
    expect(sayPlace(1, 10)).toBe(10);
    expect(sayPlace(10, 10)).toBe(10);
    expect(sayPlace(11, 10)).toBe(20);
    expect(sayPlace(37, 10)).toBe(40);
    // Never less than the first ten, whatever comes in.
    expect(sayPlace(0, 10)).toBe(10);
  });

  it("the first figure is rounded like every later one", () => {
    expect(sayPool(null, 0, 10)).toBe(0);
    expect(sayPool(null, 1, 10)).toBe(0);
    expect(sayPool(null, 9, 10)).toBe(0);
    expect(sayPool(null, 29, 10)).toBe(20);
  });

  it("at least one more is needed while the gate is closed, whatever was said", () => {
    expect(neededFrom(20, 30)).toBe(10);
    expect(neededFrom(30, 30)).toBe(1);
    expect(neededFrom(40, 30)).toBe(1);
    expect(neededFrom(0, 29.5)).toBe(30);
  });

  it("for any figures: what is said is a whole number of steps, never above the pool by a step or more", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 10, max: 50 }),
        (steps, pool, step) => {
          const said = steps === null ? null : steps * step;
          const now = sayPool(said, pool, step);
          expect(now % step).toBe(0);
          expect([said, Math.floor(pool / step) * step]).toContain(now);
          expect(Math.abs(pool - now)).toBeLessThan(2 * step);
        },
      ),
    );
  });

  it("for any pool: no two pools within one step of tens are told apart by a first figure", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 9 }),
        (tens, a, b) => {
          expect(sayPool(null, tens * 10 + a, 10)).toBe(sayPool(null, tens * 10 + b, 10));
        },
      ),
    );
  });

  it("for any place: it is said as the end of its ten", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 10, max: 50 }),
        (place, step) => {
          const said = sayPlace(place, step);
          expect(said % step).toBe(0);
          expect(said).toBeGreaterThanOrEqual(place);
          expect(said - place).toBeLessThan(step);
        },
      ),
    );
  });
});

describe("a change of what a person declares", () => {
  const man = (seeks: string[]) => ({ gender: "man", seeks });

  it("joining a group that waits is a reason to decide anew, leaving one is not", () => {
    // Seeks their own gender too, then not any more: into the group.
    expect(joinsAGroupThatWaits(man(["woman", "man"]), man(["woman"]))).toBe(true);
    // From non-binary, who wait with nobody.
    expect(joinsAGroupThatWaits({ gender: "non_binary", seeks: ["woman"] }, man(["woman"]))).toBe(
      true,
    );
    // From one group to the other.
    expect(joinsAGroupThatWaits({ gender: "woman", seeks: ["man"] }, man(["woman"]))).toBe(true);
    // Out of the group, to where nobody waits.
    expect(joinsAGroupThatWaits(man(["woman"]), man(["woman", "man"]))).toBe(false);
    expect(joinsAGroupThatWaits(man(["woman"]), { gender: "non_binary", seeks: ["woman"] })).toBe(
      false,
    );
  });

  it("a change within the same group takes nothing back", () => {
    expect(joinsAGroupThatWaits(man(["woman"]), man(["woman", "non_binary"]))).toBe(false);
    expect(joinsAGroupThatWaits(man(["woman"]), man(["woman"]))).toBe(false);
    expect(joinsAGroupThatWaits(man(["man"]), man(["man", "woman"]))).toBe(false);
  });

  it("a first declaration is a joining, and an unfinished one is none", () => {
    expect(joinsAGroupThatWaits({ gender: null, seeks: null }, man(["woman"]))).toBe(true);
    expect(joinsAGroupThatWaits({ gender: "man", seeks: null }, man(["woman"]))).toBe(true);
    expect(joinsAGroupThatWaits(man(["woman"]), { gender: "man", seeks: null })).toBe(false);
    expect(joinsAGroupThatWaits(man(["woman"]), { gender: null, seeks: ["woman"] })).toBe(false);
  });
});
