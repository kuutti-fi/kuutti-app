// Icon set from the ink mask. The source is cropped at its left and bottom,
// so every icon anchors the mark bottom-left: the cuts become the icon's own
// edges and the tail rises out of the corner. White ink on the primary blue
// of tokens.css (light set: hsl(224 76% 48%) = #1D4FD7).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canvas, composite, decode, encode } from "./png.mjs";

const [, , maskPath, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const PRIMARY = [0x1d, 0x4f, 0xd7, 255];
const WHITE = [255, 255, 255];

function scaled(size) {
  const out = `${outDir}/mask-${size}.png`;
  execFileSync("sips", ["-z", String(size), String(size), maskPath, "--out", out], {
    stdio: "ignore",
  });
  return decode(readFileSync(out));
}

/** Mark at `scale` of a `size` canvas, bottom-left, over `background` (alpha 0 = none). */
function icon(size, scale, background, { alpha }) {
  const mark = scaled(Math.round(size * scale));
  const c = canvas(size, size, background);
  composite(c, mark, 0, size - mark.h, WHITE);
  return encode(c, { alpha });
}

// iOS: no alpha, the squircle mask is Apple's. 0.9 leaves a 14 % margin on the
// right and 24 % on top; the tail's exits fall inside the rounded corner.
writeFileSync(`${outDir}/icon.png`, icon(1024, 0.9, PRIMARY, { alpha: false }));
// Android adaptive: the launcher shows roughly the central two thirds, so the
// mark is smaller; what it clips is the same cut the source already has.
writeFileSync(
  `${outDir}/android-icon-foreground.png`,
  icon(512, 0.78, [0, 0, 0, 0], { alpha: true }),
);
writeFileSync(
  `${outDir}/android-icon-background.png`,
  encode(canvas(512, 512, PRIMARY), { alpha: true }),
);
writeFileSync(
  `${outDir}/android-icon-monochrome.png`,
  icon(432, 0.78, [0, 0, 0, 0], { alpha: true }),
);
// Favicon: the iOS icon, small.
execFileSync("sips", ["-z", "48", "48", `${outDir}/icon.png`, "--out", `${outDir}/favicon.png`], {
  stdio: "ignore",
});
// A preview of the Android result: foreground over background, circle-clipped
// to the visible two thirds, so the launcher's view can be judged here.
const preview = canvas(512, 512, [255, 255, 255, 255]);
const fg = decode(readFileSync(`${outDir}/android-icon-foreground.png`));
const bg = canvas(512, 512, PRIMARY);
composite(bg, fg, 0, 0);
const r = 512 * 0.33;
for (let y = 0; y < 512; y++)
  for (let x = 0; x < 512; x++) {
    const inside = (x - 256) ** 2 + (y - 256) ** 2 <= r * r;
    const o = (y * 512 + x) * 4;
    if (inside) preview.px.set(bg.px.subarray(o, o + 4), o);
  }
writeFileSync(`${outDir}/preview-android.png`, encode(preview, { alpha: false }));
console.log("written:", outDir);
