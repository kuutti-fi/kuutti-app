#!/usr/bin/env bash
# A tofu plan as a sticky pull-request comment: a title and a code fence,
# posted through sticky-comment.sh so a re-run replaces the plan in place.
set -euo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${PR_NUMBER:?}" "${MARKER:?}" "${TITLE:?}" "${BODY_FILE:?}" "${RUNNER_TEMP:?}"

limit=60000
plan=$(head -c "$limit" "$BODY_FILE")
if [ "$(wc -c < "$BODY_FILE")" -gt "$limit" ]; then
  plan="$plan
… truncated; the full plan is in the workflow log."
fi
fenced="$RUNNER_TEMP/plan-comment.md"
# shellcheck disable=SC2016  # the backticks are Markdown, not a substitution
printf '#### %s\n\n```\n%s\n```\n' "$TITLE" "$plan" > "$fenced"
BODY_FILE="$fenced" "$(dirname "$0")/sticky-comment.sh"
