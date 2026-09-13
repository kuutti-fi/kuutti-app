import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { buildInfo } from "./lib/version.ts";

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    JSON.stringify({
      msg: "API listening",
      port: info.port,
      version: buildInfo.version,
      commit: buildInfo.commit,
    }),
  );
});

// Drain in-flight requests on SIGTERM so a redeploy does not drop connections.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
