import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.ts";

describe("parseConfig", () => {
  it("fails without a database and names the key", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    try {
      parseConfig({});
    } catch (error) {
      expect((error as ConfigError).missing).toContain("DATABASE_URL");
    }
  });

  it("names every invalid key", () => {
    try {
      parseConfig({ DATABASE_URL: "postgres://x", PORT: "not-a-port", LOG_LEVEL: "loud" });
      throw new Error("expected ConfigError");
    } catch (error) {
      const issues = (error as ConfigError).issues.join("\n");
      expect(issues).toContain("PORT");
      expect(issues).toContain("LOG_LEVEL");
    }
  });

  it("composes DATABASE_URL from the SSM-shaped parts", () => {
    const config = parseConfig({
      DB_HOST: "rds.internal",
      DB_NAME: "kuutti",
      DB_USER: "app",
      DB_APP_PASSWORD: "p@ss word",
      APP_ENV: "staging",
    });
    const url = new URL(config.databaseUrl);
    expect(url.protocol).toBe("postgres:");
    expect(url.username).toBe("app");
    expect(decodeURIComponent(url.password)).toBe("p@ss word");
    expect(url.hostname).toBe("rds.internal");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/kuutti");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(config.corsAllowedOrigins.size).toBe(0);
  });

  it("allows the Metro origin in development only, and named origins when set", () => {
    expect([...parseConfig({ DATABASE_URL: "postgres://x" }).corsAllowedOrigins]).toEqual([
      "http://localhost:8081",
    ]);
    const named = parseConfig({
      DATABASE_URL: "postgres://x",
      CORS_ALLOWED_ORIGINS: "https://admin.kuutti.fi, https://kuutti.fi",
    });
    expect([...named.corsAllowedOrigins]).toEqual(["https://admin.kuutti.fi", "https://kuutti.fi"]);
  });
});

describe("boot", () => {
  it("exits non-zero and prints the missing key names when configuration is incomplete", async () => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      APP_ENV: "test",
    };
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      env,
      cwd: process.cwd(),
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(1);
    expect(stderr).toContain("Configuration invalid");
    expect(stderr).toContain("DATABASE_URL");
  });
});
