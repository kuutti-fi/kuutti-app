import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The command lines themselves (#55): what a wrong invocation must refuse
// before it touches messages.yaml. Each runs the script as CI and a person do.

const root = resolve(import.meta.dirname, "..");
const run = (script: string, args: string[]) => {
  const result = spawnSync(process.execPath, [resolve(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "false" },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};

describe("pnpm i18n:review", () => {
  it("does one thing at a time", () => {
    const both = run("review.ts", [
      "--approve",
      "--reflag",
      "--locale",
      "fi",
      "smoke.title",
      "--dry-run",
    ]);
    expect(both.code).toBe(1);
    expect(both.out).toMatch(/--approve and --reflag are different commands/);
    const three = run("review.ts", ["--list", "--export", "tsv", "--import", "x.tsv"]);
    expect(three.code).toBe(1);
    expect(three.out).toMatch(/different commands/);
  });

  it("stops when the comparison's ref cannot be read, and never takes a ref for an option", () => {
    const missing = run("review.ts", ["--approved-since", "no-such-ref-4711"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/could not read messages\.yaml at "no-such-ref-4711"/);
    const option = run("review.ts", ["--approved-since=--output=/tmp/kuutti-never-written"]);
    expect(option.code).toBe(1);
    expect(option.out).toMatch(/could not read messages\.yaml/);
  });

  it("compares against the commit it is given", () => {
    const head = run("review.ts", ["--approved-since", "HEAD"]);
    expect(head.code).toBe(0);
  });
});

describe("pnpm i18n:translate", () => {
  it("has no --review any more and says where the list lives", () => {
    const result = run("translate.ts", ["--review"]);
    expect(result.code).not.toBe(0);
    expect(result.out).toMatch(/Unknown option '--review'/);
  });

  it("refuses a selector-less --compare and --retranslate without sending anything", () => {
    expect(run("translate.ts", ["--compare", "--locale", "fi"]).out).toMatch(
      /needs --prefix or --keys/,
    );
    expect(run("translate.ts", ["--retranslate"]).out).toMatch(/needs --prefix or --keys/);
  });
});
