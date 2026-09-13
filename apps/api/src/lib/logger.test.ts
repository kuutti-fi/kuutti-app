import { describe, expect, it } from "vitest";
import { captureLogger } from "../test/harness.ts";

describe("logger redaction", () => {
  it("never writes hetu, email, message text or credentials", async () => {
    const { logger, lines } = await captureLogger();
    logger.info(
      {
        hetu: "010190-123A",
        email: "a@b.fi",
        message: "hello there",
        authorization: "Bearer secret-token",
        nested: { personal_identity_code: "010190-123A", email: "c@d.fi", text: "private words" },
        accountId: "acc-1",
      },
      "probe",
    );
    const out = JSON.stringify(lines());
    for (const forbidden of [
      "010190-123A",
      "a@b.fi",
      "hello there",
      "secret-token",
      "c@d.fi",
      "private words",
    ]) {
      expect(out).not.toContain(forbidden);
    }
    expect(out).toContain("[redacted]");
    expect(out).toContain("acc-1");
  });
});
