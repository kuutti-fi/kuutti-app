import { importPKCS8 } from "jose";
import * as client from "openid-client";
import type { Config } from "../lib/config.ts";
import { BrokerError, type BrokerIdentity, HETU_CLAIM, type IdentityBroker } from "./broker.ts";
import { isTeliaIssuer } from "./discovery.ts";

/**
 * The OpenID Connect adapter (#33, docs/vendors/telia.md). One implementation,
 * two configurations: against Telia the authorization request is a signed
 * request object with `acr_values`, the token request authenticates with
 * private_key_jwt, and the ID token arrives encrypted to our second key; against
 * the mock IdP it is plain OIDC over http. Both are decided by the issuer at
 * boot, never per request.
 */
export type OidcBrokerOptions = {
  issuer: string;
  clientId: string;
  redirectUri: string;
  acrValues: string | null;
  jwksMaxAgeSeconds: number;
  /** PEM (PKCS#8). Both required for a Telia issuer, both ignored for the mock. */
  signingKeyPem: string | null;
  encryptionKeyPem: string | null;
};

export function brokerOptionsFromConfig(config: Config): OidcBrokerOptions | null {
  if (!config.OIDC_ISSUER || !config.OIDC_CLIENT_ID || !config.OIDC_REDIRECT_URI) return null;
  return {
    issuer: config.OIDC_ISSUER,
    clientId: config.OIDC_CLIENT_ID,
    redirectUri: config.OIDC_REDIRECT_URI,
    acrValues: config.OIDC_ACR_VALUES ?? null,
    jwksMaxAgeSeconds: config.OIDC_JWKS_MAX_AGE_SECONDS,
    signingKeyPem: config.TELIA_SIGNING_KEY ?? null,
    encryptionKeyPem: config.TELIA_ENCRYPTION_KEY ?? null,
  };
}

export class OidcBroker implements IdentityBroker {
  private readonly expectedAcr: Set<string> | null;

  private constructor(
    readonly issuer: string,
    private readonly configuration: client.Configuration,
    private readonly options: OidcBrokerOptions,
    private readonly signingKey: CryptoKey | null,
  ) {
    const values = options.acrValues?.split(/\s+/).filter((v) => v.length > 0) ?? [];
    this.expectedAcr = values.length > 0 ? new Set(values) : null;
  }

  /** Discovery once, at boot; a Telia issuer without our keys is a configuration error. */
  static async create(options: OidcBrokerOptions): Promise<OidcBroker> {
    const telia = isTeliaIssuer(options.issuer);
    if (telia && (!options.signingKeyPem || !options.encryptionKeyPem)) {
      throw new Error("a Telia issuer needs TELIA_SIGNING_KEY and TELIA_ENCRYPTION_KEY");
    }
    const signingKey = options.signingKeyPem
      ? await importPKCS8(options.signingKeyPem, "RS256", { extractable: false })
      : null;
    const encryptionKey = options.encryptionKeyPem
      ? await importPKCS8(options.encryptionKeyPem, "RSA-OAEP", { extractable: false })
      : null;

    // Telia's guide has the client assertion's aud as the token endpoint
    // (docs/vendors/telia.md), where the library would put the issuer. The
    // hook runs at token-request time, when discovery has filled the endpoint.
    const assertionAudience: client.ModifyAssertionOptions = {
      [client.modifyAssertion]: (_header, payload) => {
        const tokenEndpoint = configuration.serverMetadata().token_endpoint;
        if (tokenEndpoint) payload.aud = tokenEndpoint;
      },
    };
    const configuration: client.Configuration = await client.discovery(
      new URL(options.issuer),
      options.clientId,
      { id_token_signed_response_alg: "RS256" },
      telia && signingKey ? client.PrivateKeyJwt(signingKey, assertionAudience) : client.None(),
      {
        execute: telia ? [] : [client.allowInsecureRequests],
      },
    );
    if (encryptionKey) {
      client.enableDecryptingResponses(configuration, ["A128CBC-HS256", "A256GCM"], encryptionKey);
    }
    return new OidcBroker(options.issuer, configuration, options, signingKey);
  }

  async startLogin(input: { state: string; nonce: string; locale: string | null }): Promise<URL> {
    const parameters: Record<string, string> = {
      redirect_uri: this.options.redirectUri,
      scope: "openid",
      response_type: "code",
      state: input.state,
      nonce: input.nonce,
    };
    if (this.options.acrValues) parameters.acr_values = this.options.acrValues;
    if (input.locale) parameters.ui_locales = input.locale;
    if (this.signingKey) {
      // Telia: the request is a signed JWT (RFC 9101) with our sig key; iss,
      // aud, jti and exp are added by the library.
      return client.buildAuthorizationUrlWithJAR(this.configuration, parameters, this.signingKey);
    }
    return client.buildAuthorizationUrl(this.configuration, parameters);
  }

  async completeLogin(input: {
    callbackUrl: URL;
    state: string;
    nonce: string;
  }): Promise<BrokerIdentity> {
    const callbackUrl = registeredCallbackUrl(this.options.redirectUri, input.callbackUrl);
    let claims: client.IDToken | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(this.configuration, callbackUrl, {
        expectedState: input.state,
        expectedNonce: input.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (error) {
      // The library's messages name codes and checks, never claims.
      throw new BrokerError(error instanceof Error ? error.message : "token exchange failed");
    }
    if (!claims) throw new BrokerError("no ID token");
    return identityFromClaims(claims, this.expectedAcr);
  }
}

/**
 * The library sends the callback URL, minus its query, as the token request's
 * redirect_uri. The request's own URL is whatever the Host header and the
 * TLS-terminating proxy made of it (http://… behind Traefik), so the registered
 * value is used and only the bank's answer is taken from the request.
 */
export function registeredCallbackUrl(redirectUri: string, requestUrl: URL): URL {
  const url = new URL(redirectUri);
  url.search = requestUrl.search;
  return url;
}

/** The ID token's claims reduced to the broker's answer; `expectedAcr` is the set asked for, if any. */
export function identityFromClaims(
  claims: client.IDToken,
  expectedAcr: ReadonlySet<string> | null,
): BrokerIdentity {
  const hetu = claims[HETU_CLAIM];
  if (typeof hetu !== "string" || hetu.length === 0) throw new BrokerError("no identity code");
  const acr = typeof claims.acr === "string" ? claims.acr : null;
  if (!acr) throw new BrokerError("no acr");
  // The level we asked for is the level we accept: a weaker one (a test
  // emulator, a lower LoA) is a broker misconfiguration, not a login.
  if (expectedAcr && !expectedAcr.has(acr)) throw new BrokerError("unexpected acr");
  const amr = Array.isArray(claims.amr) ? claims.amr.filter((v) => typeof v === "string") : [];
  const authTime = typeof claims.auth_time === "number" ? claims.auth_time : claims.iat;
  return {
    hetu,
    subject: claims.sub,
    sessionIndex: typeof claims.session_index === "string" ? claims.session_index : null,
    tokenId: typeof claims.jti === "string" ? claims.jti : null,
    authenticatedAt: new Date(authTime * 1000),
    acr,
    amr,
  };
}
