import type { GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it } from "vitest";
import { loadSsmParameters, parameterNameToEnvKey } from "./ssm.ts";

describe("parameterNameToEnvKey", () => {
  it("maps a parameter path under the prefix to an upper snake key", () => {
    expect(parameterNameToEnvKey("/kuutti/staging/db-app-password", "/kuutti/staging/")).toBe(
      "DB_APP_PASSWORD",
    );
    expect(parameterNameToEnvKey("/kuutti/staging/nested/log-level", "/kuutti/staging/")).toBe(
      "NESTED_LOG_LEVEL",
    );
  });
});

describe("loadSsmParameters", () => {
  it("follows pagination and decrypts", async () => {
    const calls: GetParametersByPathCommand[] = [];
    const client = {
      send: async (command: GetParametersByPathCommand) => {
        calls.push(command);
        return calls.length === 1
          ? {
              Parameters: [{ Name: "/kuutti/staging/db-host", Value: "rds.internal" }],
              NextToken: "t2",
            }
          : { Parameters: [{ Name: "/kuutti/staging/db-name", Value: "kuutti" }] };
      },
    };
    const values = await loadSsmParameters("/kuutti/staging/", client);
    expect(values).toEqual({ DB_HOST: "rds.internal", DB_NAME: "kuutti" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toMatchObject({
      Path: "/kuutti/staging/",
      Recursive: true,
      WithDecryption: true,
    });
    expect(calls[1]?.input.NextToken).toBe("t2");
  });
});
