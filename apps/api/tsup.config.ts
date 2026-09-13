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
  splitting: false,
  noExternal: [/.*/],
  external: ["pg-native", "pino-pretty"],
  sourcemap: true,
  clean: true,
  minify: false,
  // CommonJS dependencies (pg, pino) call require() at runtime; an ESM bundle has
  // none unless one is created from the bundle's own location.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
