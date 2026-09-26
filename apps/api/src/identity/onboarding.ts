import type { Queryable } from "@kuutti/db";
import { CONSENT_VERSIONS } from "@kuutti/i18n";
import {
  CONSENT_KINDS,
  type ConsentKind,
  type ConsentRecord,
  type ConsentRequest,
  type ConsentsResponse,
  type ConsentVersions,
  type Gender,
  type OnboardingStatus,
  type OnboardingStep,
  type PondSummary,
  type PreferencesResponse,
} from "@kuutti/schema";
import { AppError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import { readPreferences } from "../matching/index.ts";
import { findPondOfAccount } from "../pond/index.ts";
import * as repo from "./repo.ts";

// Onboarding and consents (#46, ADR-010). The binding texts live under
// legal.<kind>.* in messages.yaml with a consent_version; the build emits the
// current version per kind, and a consent counts only for that version. The
// account becomes active when everything required is there: a rule computed
// from the rows on every status read, never a flag a route sets.

export type OnboardingDeps = { db: Queryable; logger: Logger; now: () => Date };

function currentVersions(): ConsentVersions {
  const out: Partial<Record<ConsentKind, string>> = {};
  for (const kind of CONSENT_KINDS) {
    const version = CONSENT_VERSIONS[kind];
    if (!version)
      throw new Error(`messages.yaml has no legal.${kind}.* wording with a consent_version`);
    out[kind] = version;
  }
  return out as ConsentVersions;
}

/** The consent_version of each wording as built; a consent must name it to count. */
export const CURRENT_CONSENT_VERSIONS: ConsentVersions = currentVersions();

/** Pure: what activation still waits for. Research is never one of them. */
export function missingSteps(input: {
  gender: Gender | null;
  preferences: PreferencesResponse;
  pond: PondSummary | null;
  terms: string | null;
  privacy: string | null;
}): OnboardingStep[] {
  const missing: OnboardingStep[] = [];
  if (!input.gender) missing.push("gender");
  if (!input.preferences.seeks) missing.push("seeks");
  if (!input.preferences.ageWindow) missing.push("age_window");
  if (!input.pond) missing.push("pond");
  if (!input.terms) missing.push("terms");
  if (!input.privacy) missing.push("privacy");
  return missing;
}

const toRecord = (row: repo.ConsentRow): ConsentRecord => ({
  kind: row.kind as ConsentKind,
  version: row.version,
  locale: row.locale as ConsentRecord["locale"],
  givenAt: row.givenAt.toISOString(),
  withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
});

/** The active consent of the kind for the current wording, or null: an old version reads as none. */
function acceptedCurrent(rows: repo.ConsentRow[], kind: ConsentKind): repo.ConsentRow | null {
  return (
    rows.find(
      (r) =>
        r.kind === kind && r.withdrawnAt === null && r.version === CURRENT_CONSENT_VERSIONS[kind],
    ) ?? null
  );
}

export async function onboardingStatus(
  deps: OnboardingDeps,
  accountId: string,
): Promise<OnboardingStatus> {
  const account = await repo.findAccountById(deps.db, accountId);
  if (!account || account.state === "deleted") {
    throw new AppError(404, "not_found", "No live account");
  }
  const [preferences, pond, consents] = await Promise.all([
    readPreferences(deps.db, accountId),
    findPondOfAccount(deps.db, accountId),
    repo.listConsents(deps.db, accountId),
  ]);
  const terms = acceptedCurrent(consents, "terms")?.version ?? null;
  const privacy = acceptedCurrent(consents, "privacy")?.version ?? null;
  const research = acceptedCurrent(consents, "research");
  const missing = missingSteps({ gender: account.gender, preferences, pond, terms, privacy });
  let state = account.state;
  if (missing.length === 0 && state === "registered") {
    if (await repo.activateAccount(deps.db, accountId, deps.now())) {
      state = "active";
      deps.logger.info({ accountId }, "account activated");
    }
  }
  return {
    state,
    gender: account.gender,
    pond,
    preferences,
    consents: {
      terms,
      privacy,
      research: research
        ? { version: research.version, givenAt: research.givenAt.toISOString() }
        : null,
    },
    currentVersions: CURRENT_CONSENT_VERSIONS,
    missing,
    complete: missing.length === 0,
  };
}

export async function consentsOf(
  deps: OnboardingDeps,
  accountId: string,
): Promise<ConsentsResponse> {
  const rows = await repo.listConsents(deps.db, accountId);
  return { consents: rows.map(toRecord), currentVersions: CURRENT_CONSENT_VERSIONS };
}

/** A consent for the current wording, recorded once; an old version is refused, said in words. */
export async function giveConsent(
  deps: OnboardingDeps,
  accountId: string,
  request: ConsentRequest,
): Promise<ConsentsResponse> {
  if (request.version !== CURRENT_CONSENT_VERSIONS[request.kind]) {
    throw new AppError(409, "agreement_outdated", "The wording has a newer version", {
      kind: request.kind,
    });
  }
  const outcome = await repo.recordConsent(deps.db, accountId, request, deps.now());
  if (outcome === "no_account") throw new AppError(404, "not_found", "No live account");
  if (outcome === "recorded") {
    deps.logger.info(
      { accountId, kind: request.kind, version: request.version, locale: request.locale },
      "consent given",
    );
  }
  return consentsOf(deps, accountId);
}

/** Research is the one consent a person withdraws; terms and privacy end with the account. */
export async function withdrawResearchConsent(
  deps: OnboardingDeps,
  accountId: string,
): Promise<ConsentsResponse> {
  const withdrawn = await repo.withdrawConsent(deps.db, accountId, "research", deps.now());
  if (withdrawn > 0) deps.logger.info({ accountId, kind: "research" }, "consent withdrawn");
  return consentsOf(deps, accountId);
}

export async function declareGender(
  deps: OnboardingDeps,
  accountId: string,
  gender: Gender,
): Promise<void> {
  if (!(await repo.setGender(deps.db, accountId, gender))) {
    throw new AppError(404, "not_found", "No live account");
  }
  // The value stays out of the log: self-declared, and nobody's business there.
  deps.logger.info({ accountId }, "gender declared");
}

/** The export (#51): every consent ever given, withdrawn ones included (ADR-010). */
export async function exportConsents(db: Queryable, accountId: string): Promise<ConsentRecord[]> {
  return (await repo.listConsents(db, accountId)).map(toRecord);
}
