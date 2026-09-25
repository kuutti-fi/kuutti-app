import type { Queryable } from "@kuutti/db";

// The audit log (TD-5, security checklist "Moderator actions, disclosure
// requests, and photo views by staff write to the immutable audit table").
// One row per thing a member of staff did or saw, keyed by their identity
// (never an account); the table refuses UPDATE and DELETE by trigger
// (migration 0006), so a row written here is a row kept for five years
// (rules/db.md). `detail` is a small closed structure, never text a person
// typed.

export const AUDIT_ACTIONS = ["photo.view", "photo.approve", "photo.reject"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  actorIdentityId: string;
  action: AuditAction;
  subjectType: "photo";
  subjectId: string;
  detail?: Record<string, string | number | boolean | null>;
};

/** Writes before the thing happens: a view whose audit row failed is a view that does not happen. */
export async function recordAudit(db: Queryable, entry: AuditEntry): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_log (actor_identity_id, action, subject_type, subject_id, detail)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      entry.actorIdentityId,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("audit_log insert returned no row");
  return id;
}
