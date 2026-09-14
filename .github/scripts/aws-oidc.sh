#!/usr/bin/env bash
# Hands the job's GitHub OIDC token to the AWS CLI and the AWS provider through
# the web-identity environment: every later call assumes AWS_ROLE_ARN itself.
# No third-party action, no credential written anywhere but the runner's temp.
set -euo pipefail
: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?the job needs id-token: write}"
: "${ACTIONS_ID_TOKEN_REQUEST_URL:?}" "${AWS_ROLE_ARN:?}" "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}"

curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value > "$RUNNER_TEMP/oidc-token"
echo "AWS_WEB_IDENTITY_TOKEN_FILE=$RUNNER_TEMP/oidc-token" >> "$GITHUB_ENV"
export AWS_WEB_IDENTITY_TOKEN_FILE="$RUNNER_TEMP/oidc-token"
echo "assumed $(aws sts get-caller-identity --query Arn --output text)"
