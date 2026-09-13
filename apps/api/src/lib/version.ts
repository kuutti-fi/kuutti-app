import { execSync } from "node:child_process";

/**
 * Build identity. Injected at image build time (APP_VERSION, GIT_COMMIT, BUILT_AT);
 * in local dev, falls back to git so the smoke screen shows the working commit.
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

const isProduction = process.env.NODE_ENV === "production";

export const buildInfo = {
  version: process.env.APP_VERSION ?? "0.0.0-dev",
  commit: process.env.GIT_COMMIT ?? (isProduction ? "unknown" : (gitShortCommit() ?? "unknown")),
  builtAt: process.env.BUILT_AT ?? new Date().toISOString(),
} as const;
