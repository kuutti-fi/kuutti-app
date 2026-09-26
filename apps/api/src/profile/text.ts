/**
 * The plain-text rule (#47, ADR-009): nothing a person types for the card
 * may carry a way to reach them outside Kuutti before a match (Product
 * constraints: no pre-match links; TD-8's contact_details reason, for text).
 * A refusal names what was found, never the text itself. The rule is blunt
 * on purpose: a false refusal costs a rephrase, a false pass costs a person
 * their pre-match anonymity. The text is normalised first (compatibility
 * forms, format characters removed), so a fullwidth digit or a zero-width
 * space is not a way around it.
 */
export type ContactKind = "email" | "url" | "phone" | "handle";

const EMAIL = /[\p{L}\p{N}._+-]+@[\p{L}\p{N}-]+\.[\p{L}\p{N}.-]+/u;
/** "aino at gmail dot com", "aino (at) gmail (dot) com", "aino[ät]example[piste]fi". */
const SPELLED_EMAIL = /\b(?:at|ät)\b[^\n]{0,40}\b(?:dot|piste)\b|[([{]\s*(?:at|ät)\s*[)\]}]/iu;
/** A scheme or www, or any bare domain: a word, a dot and two or more letters, whatever the ending. */
const URL_LIKE =
  /\b(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}])[\p{L}\p{N}-]+\.\p{L}{2,24}(?![\p{L}\p{N}])/iu;
/** Seven or more digits, any script, with anything but letters and digits between them. */
const PHONE = /(?:\+?\p{Nd}[^\p{L}\p{N}]*){7,}/u;
/** An @handle, a platform name with any suffix (Finnish inflects: "instagramissa"), or an abbreviation with a name after it. */
const HANDLE =
  /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_.]{2,}|\b(?:instagram|insta|snapchat|telegram|whatsapp|tiktok|discord|signal)\p{L}*|\b(?:ig|tg|sc)\b\W{0,3}\w{2,}/iu;

export function contactDetailsIn(raw: string): ContactKind | null {
  const text = raw.normalize("NFKC").replace(/\p{Cf}/gu, "");
  if (EMAIL.test(text) || SPELLED_EMAIL.test(text)) return "email";
  if (URL_LIKE.test(text)) return "url";
  if (PHONE.test(text)) return "phone";
  if (HANDLE.test(text)) return "handle";
  return null;
}
