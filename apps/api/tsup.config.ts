import { defineConfig } from "tsup";

// One runnable file. Everything except Node built-ins is bundled, so the runtime
// image carries dist/index.js and nothing else. Revisit when a dependency with
// native bindings arrives (pg in #4 is pure JS by default).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  minify: false,
});
