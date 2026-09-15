#!/usr/bin/env bash
# One sticky Markdown comment per marker on a pull request, updated in place,
# so a re-run replaces the comment instead of stacking a new one. The body is
# posted as given; plan-comment.sh wraps a plan in a code fence first.
set -euo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${PR_NUMBER:?}" "${MARKER:?}" "${BODY_FILE:?}"

limit=60000
body=$(head -c "$limit" "$BODY_FILE")
if [ "$(wc -c < "$BODY_FILE")" -gt "$limit" ]; then
  body="$body
… truncated; the rest is in the workflow log."
fi
comment=$(printf '<!-- %s -->\n%s\n' "$MARKER" "$body")

existing=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"<!-- $MARKER -->\")) | .id" | head -n1)
if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -f body="$comment" >/dev/null
else
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -f body="$comment" >/dev/null
fi
