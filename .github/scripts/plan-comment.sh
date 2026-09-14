#!/usr/bin/env bash
# One sticky comment per marker on a pull request, updated in place, so a
# re-run replaces the plan instead of stacking a new comment.
set -euo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${PR_NUMBER:?}" "${MARKER:?}" "${TITLE:?}" "${BODY_FILE:?}"

limit=60000
body=$(head -c "$limit" "$BODY_FILE")
if [ "$(wc -c < "$BODY_FILE")" -gt "$limit" ]; then
  body="$body
… truncated; the full plan is in the workflow log."
fi
# shellcheck disable=SC2016  # the backticks are Markdown, not a substitution
comment=$(printf '<!-- %s -->\n#### %s\n\n```\n%s\n```\n' "$MARKER" "$TITLE" "$body")

existing=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"<!-- $MARKER -->\")) | .id" | head -n1)
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -f body="$comment" >/dev/null
else
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -f body="$comment" >/dev/null
fi
