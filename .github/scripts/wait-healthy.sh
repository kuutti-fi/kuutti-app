#!/usr/bin/env bash
# Polls /health until it reports the expected commit with the database
# reachable: the deploy is done when the running bytes are the built bytes.
set -euo pipefail
: "${API_URL:?}" "${COMMIT:?}"

for _ in $(seq 1 60); do
  if body=$(curl -fsS --max-time 5 "$API_URL/health" 2>/dev/null); then
    if [ "$(jq -r .commit <<< "$body")" = "$COMMIT" ] && [ "$(jq -r .db <<< "$body")" = "ok" ]; then
      echo "$body"
      exit 0
    fi
  fi
  sleep 5
done
echo "::error::$API_URL/health did not report commit $COMMIT with db ok within 5 minutes"
exit 1
