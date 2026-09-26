# Reviewing Finnish (and later Swedish) texts

For native speakers who check Kuutti's app texts. You need no programming, no git and no terminal: a GitHub account for the first way, a spreadsheet for the second. A developer does the rest.

## Why a review

Most Finnish and Swedish in the app is first written by a machine translator (or by a developer, or an AI assistant). Each such text is marked as *machine text* until a native speaker has read it. A release of the app refuses Finnish machine text, so nothing reaches the stores before you have read it (TD-17, #55).

When you approve a text, the file records a fingerprint of the English and your Finnish together. If either changes later, the text counts as unreviewed again and comes back to you. Your name is not written into the file; your approval on GitHub is the record.

Legal texts (terms, privacy, research consent) are not reviewed this way. People write them, the Finnish wording is the binding one, and each has a version number.

## Before you start

- Read `docs/i18n/tone.md`: the voice (plain, warm, informal *sinä* through verb forms, calm, never blaming) and the rules.
- Keep `packages/i18n/glossary.yaml` at hand: the fixed Finnish word for each product term. Use it exactly, so the same thing has the same name everywhere.
- "Kuutti" always stays in the nominative (the glossary's rule): rephrase a sentence that would need "Kuutissa" or "Kuuttia".
- A text in curly braces, such as `{name}` or `{seconds, plural, one {# sekunti} other {# sekuntia}}`, is filled in by the app. Keep the braces and the words inside them exactly as they are; only the ordinary words around them and inside the plural forms are yours. Never add a case ending to a `{value}`: rephrase the sentence instead (for example after a colon).
- Buttons are short. A "note" such as *at most 12 characters* or *2.1× the English: check it fits* means the room is tight.

## Seeing a text where it appears

Every pull request has a comment with a preview link to the app on the web. Open it, tap the settings button (the cog), and choose **Suomi**. Some screens need a sign-in; the preview uses a test bank login, and the developer can walk you to a screen. The column *where it shows* (or the description in the file) says where each text appears.

## Way 1: suggestions on the pull request (new texts)

When a pull request adds or changes texts, it is the natural place to review them.

1. Open the pull request, then **Files changed**, and find `packages/i18n/messages.yaml`.
2. For a line starting with `fi:` that needs a change, hover over it, click **+**, then the **Suggest changes** icon, and edit the text. Add a short reason if it helps.
3. When every Finnish text in the pull request reads right (after your suggestions), **Review changes → Approve**, and write which texts you approve if not all of them.
4. The developer applies your suggestions and marks those texts approved (`pnpm i18n:review --approve`). That push withdraws your approval, and GitHub asks you to approve again: check that the texts marked are the ones you read (each shows a warning on its line under **Files changed**), then approve. That last approval is the record of your review.

## Way 2: the review sheet (texts already in the app)

For the texts written before you joined, a sheet is quicker.

1. The developer sends you a sheet, one area of the app at a time (for example *photos*), made with `pnpm i18n:review --export tsv`.
2. Open it in Google Sheets (File → Import → Upload), Excel or Numbers. The columns:

   | column | what to do |
   |---|---|
   | key | the text's name; do not change |
   | where it shows | read it |
   | en | the English source; do not change |
   | fi | the Finnish: correct it here if needed |
   | approve | type `x` when the Finnish (after your correction) is right |
   | note | hints: tight room, changed since your last review |
   | fingerprint | do not change |

3. A corrected row without `x` is saved as your correction but stays unreviewed, which is right when you are unsure. A row you do not touch stays as it was.
4. Save as tab-separated text (Google Sheets: File → Download → Tab-separated values; Excel: *Tab delimited Text*, UTF-8 if offered) and send it back.
5. The developer imports it (`pnpm i18n:review --import`) in a pull request and asks you to approve that pull request on GitHub; each text it approves shows a warning on its line under **Files changed**. A row whose English changed in the meantime is refused and comes back in the next sheet.

## Swedish

Swedish is filled by machine and is not a released language until a native reviewer of Finland Swedish joins; the same two ways apply, with **Svenska** in the preview and a `sv` sheet.
