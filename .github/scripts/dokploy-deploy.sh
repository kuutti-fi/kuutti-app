#!/usr/bin/env bash
# Points a Dokploy application at an image and deploys it (#8). The API token
# is the one secret of the deploy path; it is scoped to the environment's
# Dokploy and never printed. Image pulls need no credential: the package is
# public.
set -euo pipefail
: "${DOKPLOY_URL:?}" "${DOKPLOY_TOKEN:?}" "${DOKPLOY_APPLICATION_ID:?}" "${IMAGE:?}"

api() {
  curl -fsS --max-time 30 -H "x-api-key: $DOKPLOY_TOKEN" -H 'content-type: application/json' "$@"
}
status() {
  api "$DOKPLOY_URL/api/application.one?applicationId=$DOKPLOY_APPLICATION_ID" | jq -r '.applicationStatus // "unknown"'
}

echo "deploying $IMAGE"
api -X POST "$DOKPLOY_URL/api/application.update" \
  --data "$(jq -cn --arg id "$DOKPLOY_APPLICATION_ID" --arg image "$IMAGE" '{applicationId: $id, dockerImage: $image}')" >/dev/null
api -X POST "$DOKPLOY_URL/api/application.deploy" \
  --data "$(jq -cn --arg id "$DOKPLOY_APPLICATION_ID" '{applicationId: $id}')" >/dev/null

# The status is still the previous deployment's for a moment; wait for this
# one to start, then for it to finish.
for _ in $(seq 1 12); do
  [ "$(status)" = "running" ] && break
  sleep 5
done
for _ in $(seq 1 120); do
  case "$(status)" in
    done) echo "Dokploy finished the deployment"; exit 0 ;;
    error) echo "::error::Dokploy reports the deployment failed; see the deployment log in Dokploy"; exit 1 ;;
  esac
  sleep 5
done
echo "::error::Dokploy did not finish within 10 minutes"
exit 1
