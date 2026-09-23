import { SessionTokens } from "@kuutti/schema";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "./api-url";

/**
 * The device's session (#35, rules/mobile.md Auth): the access token, the
 * refresh token and the session id from /auth/exchange, in expo-secure-store,
 * never AsyncStorage. The web preview keeps them in memory only: no product
 * surface on the web (rule 8). Refreshing is single-flight, so ten requests
 * that meet an expired access token cause one refresh, and a refresh the API
 * refuses signs the device out (the refresh token was retired, revoked or is
 * past its ninety days: the person logs in through their bank again).
 */
export type StoredSession = SessionTokens;

const KEY = "kuutti.session";

let memory: StoredSession | null = null;

async function persist(session: StoredSession | null): Promise<void> {
  memory = session;
  if (Platform.OS === "web") return;
  if (session === null) await SecureStore.deleteItemAsync(KEY);
  else await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

/** Loaded once at start; a value that does not parse is treated as no session. */
export async function loadSession(): Promise<StoredSession | null> {
  if (Platform.OS === "web") return memory;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    memory = raw ? SessionTokens.parse(JSON.parse(raw)) : null;
  } catch {
    memory = null;
  }
  return memory;
}

export const currentSession = (): StoredSession | null => memory;

export async function saveSession(session: StoredSession): Promise<void> {
  await persist(session);
  notify();
}

export async function clearSession(): Promise<void> {
  await persist(null);
  notify();
}

type Listener = (session: StoredSession | null) => void;
const listeners = new Set<Listener>();
const notify = () => {
  for (const listener of listeners) listener(memory);
};

/** Called whenever the stored session changes, including when a refresh fails and the device is signed out. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Refresh when the access token has under this long left, rather than after a 401. */
const REFRESH_AHEAD_MS = 30 * 1000;

export function accessTokenIsStale(session: StoredSession, now = Date.now()): boolean {
  return new Date(session.accessExpiresAt).getTime() - now < REFRESH_AHEAD_MS;
}

let inFlight: Promise<StoredSession | null> | null = null;

/**
 * One refresh at a time: callers that arrive while one runs get its result.
 * Null means the device is signed out. Uses fetch directly rather than the
 * typed client, whose middleware would call back into here.
 */
export function refreshSession(): Promise<StoredSession | null> {
  if (inFlight) return inFlight;
  const session = memory;
  if (!session) return Promise.resolve(null);
  inFlight = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (response.status === 401) {
        await clearSession();
        return null;
      }
      if (!response.ok) return session; // the API is unwell; keep what we have and try again later
      const next = SessionTokens.parse(await response.json());
      await saveSession(next);
      return next;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Only a login this device started may end in a session here: the browser's
 * return carries a one-time code, and a code an attacker minted with their
 * own bank login and sent as a link would otherwise sign this phone into
 * their account. The mark outlives the app process (Android may end it
 * while the browser is open) and a login attempt's ten minutes.
 */
const PENDING_KEY = "kuutti.session.pending";
const PENDING_TTL_MS = 10 * 60 * 1000;
let pendingInMemory: string | null = null;

export async function markLoginStarted(now = Date.now()): Promise<void> {
  const value = String(now);
  pendingInMemory = value;
  if (Platform.OS !== "web") await SecureStore.setItemAsync(PENDING_KEY, value);
}

/** True once per started login: reading it clears it. */
export async function takeLoginStarted(now = Date.now()): Promise<boolean> {
  let value = pendingInMemory;
  if (Platform.OS !== "web") {
    try {
      value = (await SecureStore.getItemAsync(PENDING_KEY)) ?? value;
      await SecureStore.deleteItemAsync(PENDING_KEY);
    } catch {
      // Unreadable is the same as absent: the link is refused, the person taps the button again.
    }
  }
  pendingInMemory = null;
  const started = Number(value);
  return Number.isFinite(started) && now - started >= 0 && now - started <= PENDING_TTL_MS;
}
