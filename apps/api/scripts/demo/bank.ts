import { type DemoPersona, personaClaims } from "@kuutti/db/demo";
import { AuthExchangeResponse, ErrorResponse } from "@kuutti/schema";

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
};

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

export async function loginAs(
  persona: DemoPersona,
  context: BankContext,
  locale: "fi" | "sv" | "en" = "fi",
): Promise<Login> {
  const { api, fetch } = context;
  const start = await fetch(new URL(`/auth/start?platform=ios&locale=${locale}`, api), {
    redirect: "manual",
  });
  if (start.status === 503) {
    throw new DemoError(
      "the API has no bank identification: is the mock bank running, and are OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_REDIRECT_URI and HETU_HMAC_KEY set for it?",
    );
  }
  const bank = locationOf(start, "/auth/start");

  const posted = await fetch(bank, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: persona.key,
      claims: JSON.stringify(personaClaims(persona, context.now())),
    }).toString(),
  });
  const back = locationOf(posted, `the bank, as ${persona.key}`);

  // The redirect URI is the API's own and may name a host this process does
  // not reach it by: the path and the query are what matter.
  const callback = await fetch(new URL(`${back.pathname}${back.search}`, api), {
    redirect: "manual",
  });
  const link = locationOf(callback, "/auth/callback");
  const error = link.searchParams.get("error");
  if (error) return { kind: "refused", error, until: link.searchParams.get("until") };
  const code = link.searchParams.get("code");
  if (!code) throw new DemoError(`/auth/callback: no code and no error in ${link.protocol}`);

  const exchanged = await fetch(new URL("/auth/exchange", api), {
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
  const response = await context.fetch(new URL(path, context.api), {
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
