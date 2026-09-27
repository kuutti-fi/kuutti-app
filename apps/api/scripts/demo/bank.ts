import { type DemoPersona, personaClaims } from "@kuutti/db/demo";
import { AuthExchangeResponse, ErrorResponse, HealthResponse } from "@kuutti/schema";

/**
 * A persona's way through the bank and back, as a browser and the app walk it
 * (#73, ADR-014 §12): /auth/start sends to the mock bank, the bank's page is
 * answered with the persona's name and claims, the bank sends back to
 * /auth/callback, and the one-time code of the deep link is exchanged for a
 * session. Nothing here knows how an identity is made: that is the API's.
 */
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type BankContext = {
  /** The API as this process reaches it, e.g. http://localhost:3000. */
  api: string;
  fetch: Fetch;
  now: () => Date;
  /** How to wait for the rate limit; a test does not wait. */
  sleep?: (ms: number) => Promise<void>;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether the address is on this computer: the only place a persona's claims are sent to. */
export const onThisComputer = (url: URL): boolean => LOOPBACK.has(url.hostname);

/**
 * Whether the address is this computer's own: a loopback one, or one of the
 * addresses of its network interfaces, which the caller reads. The object
 * store is named by the computer's address on the network when a phone has
 * to load photos from it (env.example), and that is this computer still.
 * Another machine on the same network is not, and neither is a name that
 * would have to be looked up: what a name resolves to can change between the
 * question and the deletion.
 */
export function ofThisComputer(url: URL, addresses: readonly string[]): boolean {
  if (onThisComputer(url)) return true;
  // An IPv6 address stands in brackets in a URL and without them on an interface.
  return addresses.includes(url.hostname.replace(/^\[|\]$/g, ""));
}

/** The longest the walk waits for the rate limit's window, which is a minute. */
const RETRY_AFTER_MAX_SECONDS = 65;

/**
 * One request, and once more after the wait the API asks for when it answers
 * 429: the histories are some seventy requests against a limit of 120 a
 * minute, and a second reset within the minute would otherwise stop half way.
 */
async function patient(context: BankContext, input: URL, init?: RequestInit): Promise<Response> {
  const first = await context.fetch(input, init);
  if (first.status !== 429) return first;
  const asked = Number(first.headers.get("retry-after"));
  const seconds = Number.isFinite(asked) && asked > 0 ? asked : RETRY_AFTER_MAX_SECONDS;
  const sleep = context.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  await sleep(Math.min(seconds, RETRY_AFTER_MAX_SECONDS) * 1000);
  return context.fetch(input, init);
}

export type Login =
  | { kind: "session"; outcome: "created" | "resumed"; accessToken: string }
  | { kind: "refused"; error: string; until: string | null };

export class DemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoError";
  }
}

function locationOf(response: Response, what: string): URL {
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new DemoError(`${what}: expected a redirect, got ${response.status}`);
  }
  return new URL(location);
}

type Locale = "fi" | "sv" | "en";

/** Where the API sends a login: the bank's page, which must be on this computer. */
async function bankOf(context: BankContext, locale: Locale): Promise<URL> {
  const start = await patient(
    context,
    new URL(`/auth/start?platform=ios&locale=${locale}`, context.api),
    { redirect: "manual" },
  );
  if (start.status === 503) {
    throw new DemoError(
      "the API has no bank identification: is the mock bank running, and are OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_REDIRECT_URI and HETU_HMAC_KEY set for it?",
    );
  }
  const bank = locationOf(start, "/auth/start");
  // The claims are artificial, and still they go to the mock bank on this
  // computer and nowhere else: an API configured for a real broker would
  // send this walk to somebody who never asked for it.
  if (!onThisComputer(bank)) {
    throw new DemoError(
      `the API's bank is ${bank.host}, not the mock bank on this computer: nothing was sent`,
    );
  }
  return bank;
}

/**
 * Asks the API what it is, before anybody is erased for a history that
 * could then not be given: something answers, it answers as Kuutti's API
 * does, its database is there with its migrations, and the bank it sends a
 * login to is on this computer. One login is begun for the question and
 * never finished; the API forgets it as it forgets any.
 */
export async function lookAtApi(context: BankContext): Promise<{ commit: string; bank: string }> {
  const health = await context.fetch(new URL("/health", context.api)).catch(() => null);
  if (!health) {
    throw new DemoError(
      `nothing answers at ${context.api}: the histories need the local environment (pnpm env:up)`,
    );
  }
  const answer = HealthResponse.safeParse(await health.json().catch(() => null));
  if (!answer.success) {
    throw new DemoError(`what answers at ${context.api} is not Kuutti's API`);
  }
  if (health.status !== 200 || answer.data.status !== "ok") {
    throw new DemoError(
      `the API at ${context.api} is not ready: database ${answer.data.db}, migrations ${answer.data.migrations}`,
    );
  }
  const bank = await bankOf(context, "fi");
  return { commit: answer.data.commit, bank: bank.origin };
}

export async function loginAs(
  persona: DemoPersona,
  context: BankContext,
  locale: Locale = "fi",
): Promise<Login> {
  const { api } = context;
  const bank = await bankOf(context, locale);

  const posted = await context.fetch(bank, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: persona.key,
      claims: JSON.stringify(personaClaims(persona, context.now())),
    }).toString(),
  });
  const back = locationOf(posted, `the bank, as ${persona.key}`);
  if (back.pathname !== "/auth/callback") {
    throw new DemoError(`the bank sent back to ${back.pathname}, not to /auth/callback`);
  }

  // The redirect URI is the API's own and may name a host this process does
  // not reach it by: the query is what matters.
  const callback = await patient(context, new URL(`/auth/callback${back.search}`, api), {
    redirect: "manual",
  });
  const link = locationOf(callback, "/auth/callback");
  const error = link.searchParams.get("error");
  if (error) return { kind: "refused", error, until: link.searchParams.get("until") };
  const code = link.searchParams.get("code");
  if (!code) throw new DemoError(`/auth/callback: no code and no error in ${link.protocol}`);

  const exchanged = await patient(context, new URL("/auth/exchange", api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!exchanged.ok) throw new DemoError(`/auth/exchange: ${exchanged.status}`);
  const session = AuthExchangeResponse.parse(await exchanged.json());
  return { kind: "session", outcome: session.outcome, accessToken: session.accessToken };
}

/** One call of the API as the persona. Throws with the envelope's code, never with a body. */
export async function call(
  context: BankContext,
  accessToken: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await patient(context, new URL(path, context.api), {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null;
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = ErrorResponse.safeParse(answer);
    const code = envelope.success ? envelope.data.error.code : "unreadable";
    throw new DemoError(`${method} ${path}: ${response.status} ${code}`);
  }
  return answer;
}
