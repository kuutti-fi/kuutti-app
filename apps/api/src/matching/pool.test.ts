import { AGE_MAX, AGE_MIN, GENDERS } from "@kuutti/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inEachOthersPool, type PoolPerson, passesFiltersOf } from "./pool.ts";

// features/pond/gate.feature (#94, ADR-015): who is in whose pool.

type Gender = PoolPerson["gender"];

const person = (
  gender: Gender,
  age: number,
  seeks: string,
  min: number,
  max: number,
): PoolPerson => ({ gender, age, seeks: seeks.split(",") as Gender[], ageWindow: { min, max } });

describe("Two people are in each other's pool only when each passes what the other asked for", () => {
  it.each([
    ["woman", 30, "man", 25, 40, "man", 35, "woman", 25, 40, "in"],
    ["woman", 30, "man", 25, 40, "man", 35, "man", 25, 40, "not in"],
    ["woman", 30, "man", 25, 34, "man", 35, "woman", 25, 40, "not in"],
    ["woman", 41, "man", 25, 45, "man", 35, "woman", 25, 40, "not in"],
    ["woman", 30, "woman", 25, 40, "woman", 28, "woman", 25, 40, "in"],
    ["non_binary", 30, "man,non_binary", 25, 40, "man", 35, "non_binary", 25, 40, "in"],
    ["non_binary", 30, "man", 25, 40, "man", 35, "woman", 25, 40, "not in"],
    ["woman", 25, "man", 25, 40, "man", 40, "woman", 25, 40, "in"],
  ] as const)(
    "a %s of %i who seeks %s between %i and %i, and a %s of %i who seeks %s between %i and %i: %s",
    (aGender, aAge, aSeeks, aMin, aMax, bGender, bAge, bSeeks, bMin, bMax, expected) => {
      const a = person(aGender, aAge, aSeeks, aMin, aMax);
      const b = person(bGender, bAge, bSeeks, bMin, bMax);
      expect(inEachOthersPool(a, b)).toBe(expected === "in");
      expect(inEachOthersPool(b, a)).toBe(expected === "in");
    },
  );
});

const genderArb = fc.constantFrom(...GENDERS);
const personArb: fc.Arbitrary<PoolPerson> = fc
  .record({
    gender: genderArb,
    age: fc.integer({ min: AGE_MIN, max: AGE_MAX }),
    seeks: fc.uniqueArray(genderArb, { minLength: 1, maxLength: GENDERS.length }),
    a: fc.integer({ min: AGE_MIN, max: AGE_MAX }),
    b: fc.integer({ min: AGE_MIN, max: AGE_MAX }),
  })
  .map(({ gender, age, seeks, a, b }) => ({
    gender,
    age,
    seeks,
    ageWindow: { min: Math.min(a, b), max: Math.max(a, b) },
  }));

describe("the pool, for any two people", () => {
  it("is the same asked from either side", () => {
    fc.assert(
      fc.property(personArb, personArb, (a, b) => {
        expect(inEachOthersPool(a, b)).toBe(inEachOthersPool(b, a));
      }),
    );
  });

  it("never holds somebody a hard filter excludes, in either direction (rule 7)", () => {
    fc.assert(
      fc.property(personArb, personArb, (a, b) => {
        if (!inEachOthersPool(a, b)) return;
        for (const [viewer, candidate] of [
          [a, b],
          [b, a],
        ] as const) {
          expect(viewer.seeks).toContain(candidate.gender);
          expect(candidate.age).toBeGreaterThanOrEqual(viewer.ageWindow.min);
          expect(candidate.age).toBeLessThanOrEqual(viewer.ageWindow.max);
        }
      }),
    );
  });

  it("holds everybody who passes both ways: nobody is left out for anything else", () => {
    fc.assert(
      fc.property(personArb, personArb, (a, b) => {
        expect(inEachOthersPool(a, b)).toBe(passesFiltersOf(a, b) && passesFiltersOf(b, a));
      }),
    );
  });
});
