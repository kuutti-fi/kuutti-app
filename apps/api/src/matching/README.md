# matching

Rounds, filters, likes, budgets, recycling. TD-11, TD-12, TD-14.

#94 (ADR-015): `pool.ts` is who can be shown to whom, `inEachOthersPool`: the hard filters of onboarding in both directions, symmetric by construction. The pond gate counts pools with it and the round builder (#95) draws candidates through it; blocks and deal-breakers join in the same function with #87. `savePreferences` calls the pond's `admissionAnew`: whom one seeks decides with whom one waits at the gate (ADR-015 §9).
