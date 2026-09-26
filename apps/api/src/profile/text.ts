/**
 * The plain-text rule (#47, ADR-009): nothing a person types for the card
 * may carry a way to reach them outside Kuutti before a match (Product
 * constraints: no pre-match links; TD-8's contact_details reason, for text).
 * A refusal names what was found, never the text itself.
 */
export type ContactKind = "email" | "url" | "phone" | "handle";

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const URL_LIKE =
  /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:fi|se|com|net|org|io|app|me|ee|eu|de|uk)\b/i;
/** Seven or more digits with anything between them: a phone number however it is spaced. */
const PHONE = /(?:\+?\d[\s\-().]*){7,}/;
const HANDLE =
  /(?:^|[\s(])@\w{2,}|\b(?:instagram|insta|snapchat|telegram|whatsapp|tiktok|discord)\b/i;

export function contactDetailsIn(text: string): ContactKind | null {
  if (EMAIL.test(text)) return "email";
  if (URL_LIKE.test(text)) return "url";
  if (PHONE.test(text)) return "phone";
  if (HANDLE.test(text)) return "handle";
  return null;
}
