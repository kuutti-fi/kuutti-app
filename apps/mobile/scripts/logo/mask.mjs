// The logo PNG (black outline on white) becomes an ink mask: black pixels
// with alpha = darkness, so the app can tint it per theme. Prints the
// luminance histogram and where the ink touches the edges.
import { readFileSync, writeFileSync } from "node:fs";
import { decode, encode } from "./png.mjs";

const [, , input, output, lowArg = "40", highArg = "200"] = process.argv;
const LOW = Number(lowArg);
const HIGH = Number(highArg);
const img = decode(readFileSync(input));
const hist = new Array(8).fill(0);
let minX = img.w;
let maxX = -1;
let minY = img.h;
let maxY = -1;
const edges = { left: 0, right: 0, top: 0, bottom: 0 };
for (let y = 0; y < img.h; y++) {
  for (let x = 0; x < img.w; x++) {
    const o = (y * img.w + x) * 4;
    const lum = 0.299 * img.px[o] + 0.587 * img.px[o + 1] + 0.114 * img.px[o + 2];
    hist[Math.min(7, Math.floor(lum / 32))]++;
    const d = 255 - lum;
    const alpha = d <= LOW ? 0 : d >= HIGH ? 255 : Math.round(((d - LOW) / (HIGH - LOW)) * 255);
    img.px.set([0, 0, 0, alpha], o);
    if (alpha > 128) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (x === 0) edges.left++;
      if (x === img.w - 1) edges.right++;
      if (y === 0) edges.top++;
      if (y === img.h - 1) edges.bottom++;
    }
  }
}
writeFileSync(output, encode(img, { alpha: true }));
console.log(`${img.w}x${img.h}; luminance histogram (0-31 .. 224-255):`, hist.join(" "));
console.log(`ink bbox x ${minX}..${maxX}, y ${minY}..${maxY}; ink pixels on edges:`, edges);
