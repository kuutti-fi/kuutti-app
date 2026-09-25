import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  fixtureGif,
  fixtureHugeJpegHeader,
  fixtureJpeg,
  fixturePng,
  fixtureWebp,
} from "../test/media.ts";
import { inspectImage, PipelineError, processPhoto } from "./pipeline.ts";

// The pipeline on fixtures (#48): metadata gone from every variant, the three
// sizes, the content address, the blurhash; and what is refused before or by
// the decoder.

/** True when the bytes carry an EXIF or XMP block or a GPS tag anywhere. */
function carriesMetadata(bytes: Buffer): boolean {
  const ascii = bytes.toString("latin1");
  return ascii.includes("Exif") || ascii.includes("GPS") || ascii.includes("<x:xmpmeta");
}

describe("photo pipeline", () => {
  it("reads format and dimensions from a JPEG, PNG and WebP header without a decoder", async () => {
    expect(inspectImage(await fixtureJpeg({ width: 1200, height: 1600 }))).toEqual({
      format: "jpeg",
      width: 1200,
      height: 1600,
    });
    expect(inspectImage(await fixturePng(640, 480))).toEqual({
      format: "png",
      width: 640,
      height: 480,
    });
    expect(inspectImage(await fixtureWebp(640, 480))).toEqual({
      format: "webp",
      width: 640,
      height: 480,
    });
    expect(inspectImage(await fixtureWebp(300, 200, true))).toEqual({
      format: "webp",
      width: 300,
      height: 200,
    });
    expect(inspectImage(await fixtureGif())).toBeNull();
    expect(inspectImage(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(inspectImage(Buffer.from("not an image at all, just text"))).toBeNull();
  });

  it("a JPEG with EXIF and GPS comes out as three WebP variants with no metadata in any of them", async () => {
    const input = await fixtureJpeg({ width: 1200, height: 1600, exif: true });
    expect(carriesMetadata(input)).toBe(true); // the fixture really carries it
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processPhoto(input);
    for (const variant of ["thumb", "card", "full"] as const) {
      const bytes = out.variants[variant];
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(carriesMetadata(bytes)).toBe(false);
    }
    expect(await sharp(out.variants.thumb).metadata()).toMatchObject({ width: 200, height: 200 });
    expect(await sharp(out.variants.card).metadata()).toMatchObject({ width: 800, height: 1067 });
    expect(await sharp(out.variants.full).metadata()).toMatchObject({ width: 1200, height: 1600 });
    expect(out).toMatchObject({ width: 1200, height: 1600 });
    expect(out.key).toMatch(/^[0-9a-f]{64}$/);
    expect(out.blurhash.length).toBeGreaterThanOrEqual(6);
  });

  it("scales a large picture to 1600 px on the long edge and never enlarges a small one", async () => {
    const big = await processPhoto(await fixtureJpeg({ width: 3000, height: 2000, exif: false }));
    expect(big).toMatchObject({ width: 1600, height: 1067 });
    const small = await processPhoto(await fixturePng(320, 240));
    expect(small).toMatchObject({ width: 320, height: 240 });
    expect(await sharp(small.variants.card).metadata()).toMatchObject({ width: 800, height: 1067 });
  });

  it("bakes the EXIF orientation into the pixels", async () => {
    // Orientation 6 means rotate 90° clockwise to display: a 1200×1600 file shows as 1600×1200.
    const out = await processPhoto(
      await fixtureJpeg({ width: 1200, height: 1600, orientation: 6 }),
    );
    expect(out).toMatchObject({ width: 1600, height: 1200 });
    expect((await sharp(out.variants.full).metadata()).orientation).toBeUndefined();
  });

  it("the same picture gives the same content address; a different one does not", async () => {
    const a = await fixtureJpeg({ width: 800, height: 600, exif: false });
    const one = await processPhoto(a);
    const two = await processPhoto(Buffer.from(a));
    expect(two.key).toBe(one.key);
    const other = await processPhoto(await fixturePng(800, 600));
    expect(other.key).not.toBe(one.key);
  });

  it("refuses 40 megapixels from the header alone", async () => {
    const huge = fixtureHugeJpegHeader();
    expect(inspectImage(huge)).toEqual({ format: "jpeg", width: 8000, height: 5000 });
    await expect(processPhoto(huge)).rejects.toMatchObject({
      name: "PipelineError",
      reason: "too_many_pixels",
    });
  });

  it("refuses an animated GIF, plain text and a truncated JPEG", async () => {
    await expect(processPhoto(await fixtureGif())).rejects.toMatchObject({
      reason: "unsupported",
    });
    await expect(processPhoto(Buffer.from("hello"))).rejects.toMatchObject({
      reason: "unsupported",
    });
    const jpeg = await fixtureJpeg({ width: 400, height: 300, exif: false });
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 3));
    const failure = await processPhoto(truncated).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PipelineError);
    expect(["invalid", "unsupported"]).toContain((failure as PipelineError).reason);
  });

  it("a header that lies about its size is caught by the decoder", async () => {
    // 5000×8000 in the frame header, 40 MP, over the cap: refused by the header check.
    // A header under the cap with no scan data behind it reaches sharp and fails there.
    const header = fixtureHugeJpegHeader();
    header[25] = 0x01; // height 0x0188 = 392 (SOF0 starts at byte 20: marker, length, precision, height, width)
    header[26] = 0x88;
    header[27] = 0x02; // width 0x0200 = 512
    header[28] = 0x00;
    expect(inspectImage(header)).toEqual({ format: "jpeg", width: 512, height: 392 });
    await expect(processPhoto(header)).rejects.toMatchObject({ reason: "invalid" });
  });
});
