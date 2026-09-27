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
 */
export type ResetDeps = { db: Queryable; logger: Logger; now: () => Date; media?: MediaDeps };

export type ResetResult = { identities: number; erased: number; objects: number };

const ERASABLE = new Set(["registered", "active", "paused", "shadow_banned"]);

export async function resetPersonas(deps: ResetDeps): Promise<ResetResult> {
  const { rows: identities } = await deps.db.query<{ id: string }>(
    "SELECT id FROM identity WHERE broker_subject = ANY($1) AND $2 = ANY(amr)",
    [DEMO_PERSONAS.map((p) => p.key), MOCK_BANK_AMR],
  );
  const ids = identities.map((r) => r.id);
  if (ids.length === 0) return { identities: 0, erased: 0, objects: 0 };

  const { rows: accounts } = await deps.db.query<{ id: string; state: string }>(
    "SELECT id, state FROM account WHERE identity_id = ANY($1) AND state <> 'deleted'",
    [ids],
  );
  let erased = 0;
  let objects = 0;
  for (const account of accounts) {
    // A sanctioned account is not one a person could delete; the erasure path
    // takes it like any other once it is an ordinary account again.
    if (!ERASABLE.has(account.state)) {
      await deps.db.query("UPDATE account SET state = 'active' WHERE id = $1", [account.id]);
    }
    const summary: ErasureSummary = await eraseAccount(deps, account.id);
    erased += 1;
    objects += summary.objects;
  }
  await transaction(deps.db, (tx) => deleteIdentities(tx, ids));
  return { identities: ids.length, erased, objects };
}
