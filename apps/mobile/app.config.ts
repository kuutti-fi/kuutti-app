import { execSync } from "node:child_process";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json is the configuration. This file only stamps the git commit of the
 * JavaScript being exported or built into `extra.commit`, so the app can name
 * its own version next to the API's on the smoke screen (#10). CI sets
 * GITHUB_SHA, EAS builders EAS_BUILD_GIT_COMMIT_HASH, a checkout answers git.
 * The fingerprint skips `extra` (fingerprint.config.js): a new commit is never
 * a native change and never spends a build.
 */
function commit(): string {
  const fromEnv = process.env.GITHUB_SHA ?? process.env.EAS_BUILD_GIT_COMMIT_HASH;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: { ...config.extra, commit: commit() },
});
