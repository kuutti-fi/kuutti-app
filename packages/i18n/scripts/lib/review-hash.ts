import { createHash } from "node:crypto";

/**
 * The mark a native review leaves on a translation (#55, TD-17): a hash of the
 * English source and the reviewed text together, so that a later change to
 * either shows as a text nobody has reviewed. Trimmed and NFC-normalised, so an
 * invisible difference in how the same letters are encoded is not a change.
 * Sixteen hex digits (64 bits): short enough to read in a diff, and too many
 * to search for a different text that keeps an old review's hash.
 */
export function reviewHash(en: string, text: string): string {
  return createHash("sha256")
    .update(`${en.trim().normalize("NFC")}\u0000${text.trim().normalize("NFC")}`)
    .digest("hex")
    .slice(0, 16);
}
