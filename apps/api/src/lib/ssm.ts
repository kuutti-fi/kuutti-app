import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";

type SsmLike = {
  send(command: GetParametersByPathCommand): Promise<{
    Parameters?: { Name?: string; Value?: string }[];
    NextToken?: string;
  }>;
};

/** `/kuutti/staging/db-app-password` under prefix `/kuutti/staging/` becomes `DB_APP_PASSWORD`. */
export function parameterNameToEnvKey(name: string, prefix: string): string {
  const leaf = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return leaf.replace(/^\/+/, "").replace(/[/-]/g, "_").toUpperCase();
}

/**
 * Everything lives in one region (TD-4). The SDK reads AWS_REGION and the
 * shared config file but never the instance metadata, so a container with
 * neither would fail its first call with "Region is missing"; the image sets
 * AWS_REGION and this is the fallback.
 */
export const DEFAULT_REGION = "eu-central-1";

export function ssmRegion(env: Record<string, string | undefined> = process.env): string {
  return env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;
}

/**
 * Reads every parameter under the prefix through the instance role (TD-19: no
 * static keys). SecureStrings are decrypted by SSM; the values live in process
 * memory only. Never called in development or test.
 */
export async function loadSsmParameters(
  prefix: string,
  client: SsmLike = new SSMClient({ region: ssmRegion() }),
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );
    for (const parameter of page.Parameters ?? []) {
      if (parameter.Name && parameter.Value !== undefined) {
        values[parameterNameToEnvKey(parameter.Name, prefix)] = parameter.Value;
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return values;
}
