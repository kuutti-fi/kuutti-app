/**
 * The document served at /openapi.json outside production and written to
 * apps/api/openapi.json by `pnpm openapi`, from which packages/schema's typed
 * paths are generated (ADR-003). The version is the package version, not the
 * build, so the committed file stays stable between releases.
 */
export function openApiDocument(version: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Kuutti API",
      version,
      description:
        "Free, non-commercial dating app for Finland. Every account is verified through a Finnish bank. Source: AGPL-3.0 with App Store exception.",
    },
  };
}
