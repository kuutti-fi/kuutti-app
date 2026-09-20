// Minimal PNG codec: 8-bit, non-interlaced, gray/RGB/gray+alpha/RGBA in;
// RGB or RGBA out. Enough for the logo work; no dependencies (sips cannot
// touch pixels and this Mac has neither ImageMagick nor PIL).
import zlib from "node:zlib";

export function decode(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ct = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!channels) throw new Error(`colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const s = x * channels;
      if (channels === 1) px.set([cur[s], cur[s], cur[s], 255], o);
      else if (channels === 2) px.set([cur[s], cur[s], cur[s], cur[s + 1]], o);
      else if (channels === 3) px.set([cur[s], cur[s + 1], cur[s + 2], 255], o);
      else px.set(cur.subarray(s, s + 4), o);
    }
    prev = cur;
  }
  return { w, h, px }; // px is always RGBA
}

export function encode({ w, h, px }, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      raw.set(px.subarray(s, s + channels), y * (stride + 1) + 1 + x * channels);
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A blank RGBA canvas filled with one colour (alpha 0 = transparent). */
export function canvas(w, h, [r, g, b, a]) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4);
  return { w, h, px };
}

/** Draw `src` (RGBA) over `dst` at (x0, y0) with normal alpha blending, recolouring the ink to `ink`. */
export function composite(dst, src, x0, y0, ink) {
  for (let y = 0; y < src.h; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (y * src.w + x) * 4;
      const a = src.px[s + 3] / 255;
      if (a === 0) continue;
      const d = (dy * dst.w + dx) * 4;
      const [ir, ig, ib] = ink ?? [src.px[s], src.px[s + 1], src.px[s + 2]];
      const da = dst.px[d + 3] / 255;
      const oa = a + da * (1 - a);
      const mix = (i, sv) => Math.round((sv * a + dst.px[d + i] * da * (1 - a)) / (oa || 1));
      dst.px[d] = mix(0, ir);
      dst.px[d + 1] = mix(1, ig);
      dst.px[d + 2] = mix(2, ib);
      dst.px[d + 3] = Math.round(oa * 255);
    }
  }
}
