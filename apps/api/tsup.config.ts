import { defineConfig } from "tsup";

// One runnable file. Everything except Node built-ins is bundled, so the runtime
// image carries dist/index.js and the migrations folder, nothing else.
// pg-native is an optional native binding pg probes for; pino-pretty is dev only.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/.*/],
  external: ["pg-native", "pino-pretty"],
  sourcemap: true,
  clean: true,
  minify: false,
});
