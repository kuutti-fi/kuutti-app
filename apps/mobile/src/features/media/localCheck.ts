/**
 * The on-device check that runs on a picked photo before any byte leaves the
 * phone (#48): a nude picture is refused here, in a second, and is never sent,
 * never paid for at Rekognition, and never seen by anyone. Rekognition (#49)
 * stays the authority; this is a filter. Nothing about its verdict is stored or
 * sent: the caller stops and shows one plain text.
 *
 * The classifier itself is native (a small model behind a TFLite or ONNX
 * runtime, the maintainer's choice) and arrives with the October native batch.
 * Until then, and on the web preview always, every picture passes. Whatever
 * lands registers itself with setLocalCheck at start-up; the screen never
 * knows which implementation answered.
 */
export type LocalCheckVerdict = "allow" | "refuse";
export type LocalCheck = (uri: string) => Promise<LocalCheckVerdict>;

const allowAll: LocalCheck = async () => "allow";

let current: LocalCheck = allowAll;

/** Installs the classifier; null restores the pass-through. */
export function setLocalCheck(check: LocalCheck | null): void {
  current = check ?? allowAll;
}

/** A failing classifier refuses: a picture the check could not look at is not sent. */
export async function checkPhoto(uri: string): Promise<LocalCheckVerdict> {
  try {
    return await current(uri);
  } catch {
    return "refuse";
  }
}
