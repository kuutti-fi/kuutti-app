import type { Account, AuthRequest, Identity, Queryable } from "@kuutti/db";

// Raw parameterised SQL rather than the Drizzle builder (rules/api.md asks for
// a reason): `Deps.db` is the `Queryable` seam through which the test harness
// hands in one rolled-back transaction per test, and Drizzle's node-postgres
// driver wants a Pool or Client, not that seam. Every statement here is keyed
// by a primary or unique key; none reads user data by anything a request
// controls except the state and the code hash, which are the keys of the
// login attempt itself.

type Row = Record<string, unknown>;

const identityFrom = (r: Row): Identity => ({
  id: r.id as string,
  hetuHmac: r.hetu_hmac as string,
  standing: r.standing as Identity["standing"],
  standingChangedAt: (r.standing_changed_at as Date | null) ?? null,
  brokerSubject: (r.broker_subject as string | null) ?? null,
  brokerSessionIndex: (r.broker_session_index as string | null) ?? null,
  brokerTokenId: (r.broker_token_id as string | null) ?? null,
  authenticatedAt: (r.authenticated_at as Date | null) ?? null,
  acr: (r.acr as string | null) ?? null,
  amr: (r.amr as string[] | null) ?? null,
  deletionCount: r.deletion_count as number,
  reregisterAfter: (r.reregister_after as Date | null) ?? null,
  refusedAttempts: r.refused_attempts as number,
  createdAt: r.created_at as Date,
});

const accountFrom = (r: Row): Account => ({
  id: r.id as string,
  identityId: r.identity_id as string,
  state: r.state as Account["state"],
  stateChangedAt: (r.state_changed_at as Date | null) ?? null,
  birthYear: r.birth_year as number,
  birthMonth: r.birth_month as number,
  registeredAt: r.registered_at as Date,
  deletedAt: (r.deleted_at as Date | null) ?? null,
});

const authRequestFrom = (r: Row): AuthRequest => ({
  id: r.id as string,
  state: r.state as string,
  nonce: r.nonce as string,
  platform: r.platform as string,
  locale: (r.locale as string | null) ?? null,
  createdAt: r.created_at as Date,
  expiresAt: r.expires_at as Date,
  codeHash: (r.code_hash as string | null) ?? null,
  codeExpiresAt: (r.code_expires_at as Date | null) ?? null,
  codeUsedAt: (r.code_used_at as Date | null) ?? null,
  accountId: (r.account_id as string | null) ?? null,
  outcome: (r.outcome as string | null) ?? null,
});

export type BrokerReference = {
  brokerSubject: string;
  brokerSessionIndex: string | null;
  brokerTokenId: string | null;
  authenticatedAt: Date;
  acr: string;
  amr: string[];
};

export async function insertAuthRequest(
  db: Queryable,
  input: { state: string; nonce: string; platform: string; locale: string | null; expiresAt: Date },
): Promise<void> {
  await db.query(
    "INSERT INTO auth_request (state, nonce, platform, locale, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [input.state, input.nonce, input.platform, input.locale, input.expiresAt],
  );
}

export async function findAuthRequestByState(
  db: Queryable,
  state: string,
): Promise<AuthRequest | null> {
  const { rows } = await db.query<Row>("SELECT * FROM auth_request WHERE state = $1", [state]);
  return rows[0] ? authRequestFrom(rows[0]) : null;
}

export async function findAuthRequestByCodeHash(
  db: Queryable,
  codeHash: string,
): Promise<AuthRequest | null> {
  const { rows } = await db.query<Row>("SELECT * FROM auth_request WHERE code_hash = $1", [
    codeHash,
  ]);
  return rows[0] ? authRequestFrom(rows[0]) : null;
}

export async function attachCode(
  db: Queryable,
  input: { id: string; codeHash: string; codeExpiresAt: Date; accountId: string; outcome: string },
): Promise<void> {
  await db.query(
    `UPDATE auth_request SET code_hash = $2, code_expires_at = $3, account_id = $4, outcome = $5
     WHERE id = $1`,
    [input.id, input.codeHash, input.codeExpiresAt, input.accountId, input.outcome],
  );
}

/** Ends a login attempt without a code: the person cancelled at the bank. */
export async function expireAuthRequest(db: Queryable, id: string, at: Date): Promise<void> {
  await db.query("UPDATE auth_request SET expires_at = $2 WHERE id = $1", [id, at]);
}

/** Marks the code used; the row count says whether this call was the first to. */
export async function consumeCode(db: Queryable, id: string, at: Date): Promise<boolean> {
  const result = await db.query(
    "UPDATE auth_request SET code_used_at = $2 WHERE id = $1 AND code_used_at IS NULL",
    [id, at],
  );
  return result.rowCount === 1;
}

export async function findIdentityByHmac(
  db: Queryable,
  hetuHmac: string,
): Promise<Identity | null> {
  const { rows } = await db.query<Row>("SELECT * FROM identity WHERE hetu_hmac = $1", [hetuHmac]);
  return rows[0] ? identityFrom(rows[0]) : null;
}

export async function findLiveAccount(db: Queryable, identityId: string): Promise<Account | null> {
  const { rows } = await db.query<Row>(
    "SELECT * FROM account WHERE identity_id = $1 AND state <> 'deleted'",
    [identityId],
  );
  return rows[0] ? accountFrom(rows[0]) : null;
}

/**
 * Null when the row exists already: two first logins of the same person can
 * race here (two devices), and the loser must go through the decision again
 * rather than surface the unique violation.
 */
export async function insertIdentity(
  db: Queryable,
  input: { hetuHmac: string } & BrokerReference,
): Promise<Identity | null> {
  const { rows } = await db.query<Row>(
    `INSERT INTO identity (hetu_hmac, broker_subject, broker_session_index, broker_token_id, authenticated_at, acr, amr)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (hetu_hmac) DO NOTHING RETURNING *`,
    [
      input.hetuHmac,
      input.brokerSubject,
      input.brokerSessionIndex,
      input.brokerTokenId,
      input.authenticatedAt,
      input.acr,
      input.amr,
    ],
  );
  const row = rows[0];
  return row ? identityFrom(row) : null;
}

/** Every login refreshes the broker's reference: the latest event is the one a request would concern. */
export async function updateBrokerReference(
  db: Queryable,
  identityId: string,
  ref: BrokerReference,
): Promise<void> {
  await db.query(
    `UPDATE identity SET broker_subject = $2, broker_session_index = $3, broker_token_id = $4,
       authenticated_at = $5, acr = $6, amr = $7 WHERE id = $1`,
    [
      identityId,
      ref.brokerSubject,
      ref.brokerSessionIndex,
      ref.brokerTokenId,
      ref.authenticatedAt,
      ref.acr,
      ref.amr,
    ],
  );
}

export async function countRefusedAttempt(db: Queryable, identityId: string): Promise<void> {
  await db.query("UPDATE identity SET refused_attempts = refused_attempts + 1 WHERE id = $1", [
    identityId,
  ]);
}

export async function insertAccount(
  db: Queryable,
  input: { identityId: string; birthYear: number; birthMonth: number },
): Promise<Account> {
  const { rows } = await db.query<Row>(
    `INSERT INTO account (identity_id, state, birth_year, birth_month)
     VALUES ($1, 'registered', $2, $3) RETURNING *`,
    [input.identityId, input.birthYear, input.birthMonth],
  );
  const row = rows[0];
  if (!row) throw new Error("account insert returned no row");
  return accountFrom(row);
}

// Sessions (#35). Every read is keyed by a token hash or by (session id,
// account id): a session is only ever read as the caller's own.

export type SessionRow = {
  id: string;
  accountId: string;
  platform: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

const sessionFrom = (r: Row): SessionRow => ({
  id: r.id as string,
  accountId: r.account_id as string,
  platform: r.platform as string,
  createdAt: r.created_at as Date,
  expiresAt: r.expires_at as Date,
  revokedAt: (r.revoked_at as Date | null) ?? null,
});

const SESSION_COLUMNS = "id, account_id, platform, created_at, expires_at, revoked_at";

export async function insertSession(
  db: Queryable,
  input: {
    accountId: string;
    platform: string;
    userAgent: string | null;
    accessHash: string;
    accessExpiresAt: Date;
    refreshHash: string;
    expiresAt: Date;
    at: Date;
  },
): Promise<SessionRow> {
  const { rows } = await db.query<Row>(
    `INSERT INTO session (account_id, platform, user_agent, access_hash, access_expires_at, refresh_hash, expires_at, created_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING ${SESSION_COLUMNS}`,
    [
      input.accountId,
      input.platform,
      input.userAgent,
      input.accessHash,
      input.accessExpiresAt,
      input.refreshHash,
      input.expiresAt,
      input.at,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("session insert returned no row");
  return sessionFrom(row);
}

/** The middleware's lookup: the session with the account's state, by the access token's hash. */
export async function findSessionByAccessHash(
  db: Queryable,
  accessHash: string,
): Promise<{
  accountId: string;
  sessionId: string;
  accessExpiresAt: Date;
  revokedAt: Date | null;
  accountState: string;
  identityStanding: string;
} | null> {
  const { rows } = await db.query<Row>(
    `SELECT s.id, s.account_id, s.access_expires_at, s.revoked_at, s.expires_at, a.state, i.standing
     FROM session s JOIN account a ON a.id = s.account_id JOIN identity i ON i.id = a.identity_id
     WHERE s.access_hash = $1`,
    [accessHash],
  );
  const r = rows[0];
  if (!r) return null;
  const expiresAt = r.expires_at as Date;
  const revokedAt = (r.revoked_at as Date | null) ?? null;
  return {
    accountId: r.account_id as string,
    sessionId: r.id as string,
    // A refresh token past its life ends the session as a revocation would.
    accessExpiresAt: new Date(
      Math.min((r.access_expires_at as Date).getTime(), expiresAt.getTime()),
    ),
    revokedAt,
    accountState: r.state as string,
    identityStanding: r.standing as string,
  };
}

/**
 * The states in which a session answers. A sanction is set on the identity
 * (rules/api.md) and an account may be suspended, banned or erased on its own;
 * any of them ends every session, for the access token and the refresh token
 * alike, and the same clause serves both paths.
 */
export const LIVE_ACCOUNT_STATES = ["registered", "active", "paused", "shadow_banned"] as const;
const SESSION_ALIVE = `EXISTS (
  SELECT 1 FROM account a JOIN identity i ON i.id = a.identity_id
  WHERE a.id = session.account_id AND i.standing = 'ok'
    AND a.state IN ('registered', 'active', 'paused', 'shadow_banned'))`;

export async function touchSession(db: Queryable, sessionId: string, at: Date): Promise<void> {
  await db.query("UPDATE session SET last_used_at = $2 WHERE id = $1 AND last_used_at < $2", [
    sessionId,
    at,
  ]);
}

/**
 * Rotates in place when the presented hash is the live one; null when it is
 * not. Only the hash retired by the last rotation is kept: a token two
 * rotations old reads as unknown, which is narrower than the reuse rule but
 * costs nothing, since nobody could have used that token in between.
 */
export async function rotateSession(
  db: Queryable,
  input: {
    refreshHash: string;
    nextAccessHash: string;
    nextAccessExpiresAt: Date;
    nextRefreshHash: string;
    at: Date;
  },
): Promise<SessionRow | null> {
  const { rows } = await db.query<Row>(
    `UPDATE session
     SET refresh_hash = $2, retired_refresh_hash = $1, access_hash = $3, access_expires_at = $4, last_used_at = $5
     WHERE refresh_hash = $1 AND revoked_at IS NULL AND expires_at > $5 AND ${SESSION_ALIVE}
     RETURNING ${SESSION_COLUMNS}`,
    [
      input.refreshHash,
      input.nextRefreshHash,
      input.nextAccessHash,
      input.nextAccessExpiresAt,
      input.at,
    ],
  );
  return rows[0] ? sessionFrom(rows[0]) : null;
}

export async function findSessionByRetiredRefreshHash(
  db: Queryable,
  retiredRefreshHash: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${SESSION_COLUMNS} FROM session WHERE retired_refresh_hash = $1`,
    [retiredRefreshHash],
  );
  return rows[0] ? sessionFrom(rows[0]) : null;
}

export async function findSessionForAccount(
  db: Queryable,
  sessionId: string,
  accountId: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${SESSION_COLUMNS} FROM session WHERE id = $1 AND account_id = $2`,
    [sessionId, accountId],
  );
  return rows[0] ? sessionFrom(rows[0]) : null;
}

export async function revokeSession(
  db: Queryable,
  sessionId: string,
  at: Date,
  reason: string,
): Promise<void> {
  await db.query(
    "UPDATE session SET revoked_at = $2, revoked_reason = $3 WHERE id = $1 AND revoked_at IS NULL",
    [sessionId, at, reason],
  );
}

export async function revokeAccountSessions(
  db: Queryable,
  accountId: string,
  at: Date,
  reason: string,
): Promise<number> {
  const result = await db.query(
    "UPDATE session SET revoked_at = $2, revoked_reason = $3 WHERE account_id = $1 AND revoked_at IS NULL",
    [accountId, at, reason],
  );
  return result.rowCount ?? 0;
}

/** Ended before `endedBefore`, or whose refresh token expired: gone. */
export async function deleteDeadSessions(
  db: Queryable,
  endedBefore: Date,
  now: Date,
): Promise<number> {
  const result = await db.query(
    "DELETE FROM session WHERE (revoked_at IS NOT NULL AND revoked_at < $1) OR expires_at < $2",
    [endedBefore, now],
  );
  return result.rowCount ?? 0;
}

export async function deleteExpiredAuthRequests(db: Queryable, now: Date): Promise<number> {
  const result = await db.query(
    "DELETE FROM auth_request WHERE expires_at < $1 AND (code_expires_at IS NULL OR code_expires_at < $1)",
    [now],
  );
  return result.rowCount ?? 0;
}
