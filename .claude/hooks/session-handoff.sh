#!/usr/bin/env bash
# SessionStart and PreCompact hook: hand the previous session's notes to this one.
# stdout is injected into Claude's context. Silent when there is no handoff yet.
set -u
root="${CLAUDE_PROJECT_DIR:-.}"
file="$root/.claude/session-handoff.md"
mode="${1:-start}"
[ -f "$file" ] || exit 0
if [ "$mode" = "precompact" ]; then
  echo "Compaction is about to run. Preserve the following handoff notes verbatim in the summary; they describe the current goal, state, decisions, and next steps:"
else
  echo "Handoff from the previous session (.claude/session-handoff.md). Read it before acting; update it with /handoff when the task ends or before /clear:"
fi
echo
cat "$file"
