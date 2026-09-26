import type { Queryable } from "@kuutti/db";
import {
  Gender,
  RESEARCH_EXPORT_EVENTS_MAX,
  type ResearchExport,
  type ResearchSnapshot,
  researchFieldsOf,
} from "@kuutti/schema";
import * as repo from "./repo.ts";

/**
 * A stored snapshot read back leniently: a gender or an option the registry
 * has since retired becomes null or is left out, never a failed export. The
 * export is the right of access; one old row must not take it down.
 */
function snapshotOf(stored: unknown): ResearchSnapshot {
  const raw =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const gender = Gender.nullable().safeParse(raw.gender ?? null);
  return { gender: gender.success ? gender.data : null, fields: researchFieldsOf(raw.fields) };
}

/**
 * What research holds about the person, for the export (#51, ADR-007 §4):
 * the enrolment and the newest events, never the research_id
 * (rules/schema.md). Not enrolled: nothing, because nothing can be found.
 */
export async function exportResearch(db: Queryable, accountId: string): Promise<ResearchExport> {
  const subject = await repo.findSubject(db, accountId);
  if (!subject) return { enrolled: false, since: null, consentVersion: null, events: [] };
  const rows = await repo.listEventsOfAccount(db, accountId, RESEARCH_EXPORT_EVENTS_MAX);
  return {
    enrolled: true,
    since: subject.enrolledAt.toISOString(),
    consentVersion: subject.consentVersion,
    events: rows.map((row) => ({
      name: row.name,
      at: row.at.toISOString(),
      consentVersion: row.consentVersion,
      pond: row.pond,
      ageBand: row.ageBand,
      snapshot: snapshotOf(row.snapshot),
      props:
        typeof row.props === "object" && row.props !== null
          ? (row.props as Record<string, unknown>)
          : {},
    })),
  };
}
