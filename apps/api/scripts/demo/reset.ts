import { type Queryable, transaction } from "@kuutti/db";
import { DEMO_PERSONAS, deleteIdentities, MOCK_BANK_AMR } from "@kuutti/db/demo";
import { type ErasureSummary, eraseAccount } from "../../src/identity/index.ts";
import type { Logger } from "../../src/lib/logger.ts";
import type { MediaDeps } from "../../src/media/index.ts";

/**
 * Returns the personas of the mock bank to people Kuutti has never seen
 * (#73, ADR-014 §12). In two steps, on purpose:
 *
 * 1. every live account of a persona goes through the erasure path, the same
 *    function the app's "delete my account" calls, so a reset exercises it:
 *    sessions, photos with their objects, profile, preferences, the research
 *    mapping, and the account row left as a tombstone;
 * 2. then what erasure keeps is deleted too: the tombstones, the consent
 *    rows, the identity with its count of deletions and its waiting time.
 *    Right for a persona, which is nobody; never done for a person.
 *
 * A persona is known by what the mock bank called it: the subject is the
 * persona's name and the bank is the mock one. The command that calls this
 * has asked the server what it is first (`assertDemoTarget`): none of this
 * ever runs against a deployed database.
 *
 * A persona that holds a staff row is left alone, whole: somebody made it a
 * moderator on this machine (the moderator's command line grants the role to
 * the identity that just logged in, which locally is a persona's button), and
 * what it then wrote into the audit log can never be deleted. Erasing it and
 * failing on the deletion afterwards would leave a persona no later reset
 * could repair, so the question is asked before anybody is erased.
 *
 * A staff session that has ended is no staff row: taking a role away marks
 * the sessions revoked and leaves the rows to the API's nightly sweep, which
 * a developer's machine seldom runs. The reset deletes a persona's ended
 * sessions itself, as the sweep would, so that a persona whose role was
 * taken away is reset at once.
 */
export type ResetDeps = { db: Queryable; logger: Logger; now: () => Date; media?: MediaDeps };

export type ResetResult = {
  identities: number;
  erased: number;
  objects: number;
  /** The personas left alone because they hold a staff row, by name. */
  spared: string[];
};

export async function resetPersonas(deps: ResetDeps): Promise<ResetResult> {
  const { rows: identities } = await deps.db.query<{ id: string; key: string; staff: boolean }>(
    `SELECT i.id, i.broker_subject AS key,
            (EXISTS (SELECT 1 FROM moderator_roles m WHERE m.identity_id = i.id)
             OR EXISTS (SELECT 1 FROM admin_session s WHERE s.identity_id = i.id
                        AND s.revoked_at IS NULL AND s.expires_at >= $3)
             OR EXISTS (SELECT 1 FROM audit_log a WHERE a.actor_identity_id = i.id)
             OR EXISTS (SELECT 1 FROM photo_review r WHERE r.decided_by = i.id)) AS staff
     FROM identity i WHERE i.broker_subject = ANY($1) AND $2 = ANY(i.amr)`,
    [DEMO_PERSONAS.map((p) => p.key), MOCK_BANK_AMR, deps.now()],
  );
  const spared = [...new Set(identities.filter((r) => r.staff).map((r) => r.key))].sort();
  const ids = identities.filter((r) => !r.staff).map((r) => r.id);
  if (ids.length === 0) return { identities: 0, erased: 0, objects: 0, spared };

  const { rows: accounts } = await deps.db.query<{ id: string; state: string }>(
    "SELECT id, state FROM account WHERE identity_id = ANY($1) AND state <> 'deleted'",
    [ids],
  );
  let erased = 0;
  let objects = 0;
  for (const account of accounts) {
    // Whatever its state: the erasure path takes a banned account as it is.
    const summary: ErasureSummary = await eraseAccount(deps, account.id);
    erased += 1;
    objects += summary.objects;
  }
  await transaction(deps.db, async (tx) => {
    // The ended ones only, by the sweep's own rule (deleteDeadAdminSessions):
    // a session begun since the question above stops the deletion on its
    // foreign key, and the transaction with it.
    await tx.query(
      `DELETE FROM admin_session WHERE identity_id = ANY($1)
         AND (revoked_at IS NOT NULL OR expires_at < $2)`,
      [ids, deps.now()],
    );
    await deleteIdentities(tx, ids);
  });
  return { identities: ids.length, erased, objects, spared };
}
