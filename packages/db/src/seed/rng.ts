/**
 * A seeded random number generator for the synthetic population (#73): the
 * same seed gives the same people on every machine, so a demo can be
 * rehearsed and a failure reproduced. mulberry32: thirty-two bits of state,
 * no dependency, more than good enough to spread three hundred profiles.
 * Never `Math.random` in anything the seed writes.
 */
export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** An integer in [min, max], both included. */
  int: (min: number, max: number) => number;
  /** True with the given probability. */
  chance: (probability: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** One of the keys, each as likely as its weight says. */
  weighted: <K extends string>(weights: Readonly<Record<K, number>>) => K;
  /** `count` different items, in the order the generator drew them. */
  sample: <T>(items: readonly T[], count: number) => T[];
};

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("nothing to pick from");
    return items[Math.floor(next() * items.length)] as T;
  };
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick,
    weighted: <K extends string>(weights: Readonly<Record<K, number>>): K => {
      const entries = Object.entries(weights) as Array<[K, number]>;
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      if (!(total > 0)) throw new Error("weights sum to nothing");
      let at = next() * total;
      for (const [key, weight] of entries) {
        at -= weight;
        if (at < 0) return key;
      }
      return (entries.at(-1) as [K, number])[0];
    },
    sample: <T>(items: readonly T[], count: number): T[] => {
      const pool = [...items];
      const out: T[] = [];
      while (out.length < count && pool.length > 0) {
        out.push(pool.splice(Math.floor(next() * pool.length), 1)[0] as T);
      }
      return out;
    },
  };
}
