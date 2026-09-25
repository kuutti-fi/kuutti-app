import { createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEST_KEY_PAIR_ID, TEST_MEDIA_BASE, testSigningKeys } from "../test/media.ts";
import { cloudFrontSigner, URL_TTL_MS } from "./urls.ts";

// The signer as CloudFront verifies it (TD-8): canned policy, RSA-SHA256 over
// the policy, the expiry in the URL, nothing but the one object. The
// distribution does this check at the edge; this test does the same check
// with the public half, so a URL that CloudFront would refuse fails here.

/** CloudFront's base64 variant: + - / _ = ~ replaced, in that order. */
function fromCloudFrontBase64(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");
}

describe("CloudFront signed URLs", () => {
  const keys = testSigningKeys();
  const signer = cloudFrontSigner({
    baseUrl: TEST_MEDIA_BASE,
    keyPairId: TEST_KEY_PAIR_ID,
    privateKey: keys.privateKey,
  });
  const expiresAt = new Date("2026-10-01T12:15:00Z");

  it("signs the object URL with the canned policy the distribution verifies", async () => {
    const signed = new URL(await signer.sign("media/abc/thumb.webp", expiresAt));
    expect(signed.origin + signed.pathname).toBe(`${TEST_MEDIA_BASE}/media/abc/thumb.webp`);
    expect(signed.searchParams.get("Key-Pair-Id")).toBe(TEST_KEY_PAIR_ID);
    expect(signed.searchParams.get("Expires")).toBe(String(Math.floor(expiresAt.getTime() / 1000)));
    expect(signed.searchParams.get("Hash-Algorithm")).toBe("SHA256");

    // The canned policy is what the signature covers: one resource, one expiry.
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: `${TEST_MEDIA_BASE}/media/abc/thumb.webp`,
          Condition: { DateLessThan: { "AWS:EpochTime": Math.floor(expiresAt.getTime() / 1000) } },
        },
      ],
    });
    const signature = fromCloudFrontBase64(signed.searchParams.get("Signature") ?? "");
    const verify = createVerify("RSA-SHA256").update(policy);
    expect(verify.verify(keys.publicKey, signature)).toBe(true);
  });

  it("a URL for another object or another expiry does not verify with this one's signature", async () => {
    const a = new URL(await signer.sign("media/abc/thumb.webp", expiresAt));
    const b = new URL(await signer.sign("media/abc/full.webp", expiresAt));
    expect(a.searchParams.get("Signature")).not.toBe(b.searchParams.get("Signature"));
    const later = new URL(
      await signer.sign("media/abc/thumb.webp", new Date(expiresAt.getTime() + URL_TTL_MS)),
    );
    expect(later.searchParams.get("Signature")).not.toBe(a.searchParams.get("Signature"));
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const withSlash = cloudFrontSigner({
      baseUrl: `${TEST_MEDIA_BASE}/`,
      keyPairId: TEST_KEY_PAIR_ID,
      privateKey: keys.privateKey,
    });
    const url = new URL(await withSlash.sign("media/x/card.webp", expiresAt));
    expect(url.pathname).toBe("/media/x/card.webp");
  });
});
