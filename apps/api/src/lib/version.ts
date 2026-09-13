import { execSync } from "node:child_process";
import type { Config } from "./config.ts";

/**
 * Build identity. Injected at image build time (APP_VERSION, GIT_COMMIT,
 * BUILT_AT); in local development the commit falls back to git so the smoke
 * screen shows the working commit.
 */
function gitShortCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export type BuildInfo = { version: string; commit: string; builtAt: string };

export function buildInfo(
  config: Pick<Config, "APP_VERSION" | "GIT_COMMIT" | "BUILT_AT" | "NODE_ENV">,
): BuildInfo {
  const fallbackCommit = config.NODE_ENV === "production" ? undefined : gitShortCommit();
  return {
    version: config.APP_VERSION,
    commit: config.GIT_COMMIT ?? fallbackCommit ?? "unknown",
    builtAt: config.BUILT_AT ?? new Date().toISOString(),
  };
}
