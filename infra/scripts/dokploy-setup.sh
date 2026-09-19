#!/usr/bin/env bash
# Configures an environment's API application in Dokploy through its API, so
# the only clicks left are the ones that create credentials (the admin
# account, its 2FA and the API key). Idempotent: run it again after a change
# and it updates what exists.
#
#   DOKPLOY_URL=http://localhost:3000 DOKPLOY_TOKEN=<api key> INSTANCE_ID=<i-…> infra/scripts/dokploy-setup.sh staging
#
# INSTANCE_ID (tofu output instance_id in infra/envs/<env>) lets the script
# write the Traefik control-plane routers on the box through Run Command.
# DOKPLOY_URL is the port-forward while Dokploy has no domain of its own, the
# real https://dokploy.<env>.<domain> afterwards. The token comes from Profile
# in the UI and is exported in your shell; this script never prints it.
# Everything it sets is what infra/README.md "After the first apply" lists:
# project <env>, application api from the GHCR image, the three environment
# lines, the api.<env> domain with Let's Encrypt, Dokploy's own domain, and
# one deployment. The container's log driver is the Docker daemon default
# (awslogs, set by user_data), not an application setting.
set -euo pipefail

env="${1:?usage: dokploy-setup.sh <staging|prod>}"
: "${DOKPLOY_URL:?export DOKPLOY_URL (http://localhost:3000 through the tunnel)}"
: "${DOKPLOY_TOKEN:?export DOKPLOY_TOKEN (API key from Settings, Profile)}"
for tool in curl jq; do command -v "$tool" >/dev/null || { echo "$tool is not installed" >&2; exit 1; }; done

case "$env" in
  staging) app_env=staging; api_host=api.staging.kuutti.app; dokploy_host=dokploy.staging.kuutti.app ;;
  prod)    app_env=production; api_host=api.kuutti.app; dokploy_host=dokploy.kuutti.app ;;
  *) echo "environment must be staging or prod" >&2; exit 2 ;;
esac
image="ghcr.io/kuutti-fi/kuutti-api:main"
url="${DOKPLOY_URL%/}"

api() { curl -fsS --max-time 30 -H "x-api-key: $DOKPLOY_TOKEN" -H 'content-type: application/json' "$@"; }
get() { api "$url/api/$1"; }
post() { api -X POST "$url/api/$1" --data "$2"; }

# --- project -----------------------------------------------------------------
project_id=$(get project.all | jq -r --arg n "$env" '.[] | select(.name == $n) | .projectId' | head -1)
if [ -z "$project_id" ]; then
  project_id=$(post project.create "$(jq -cn --arg n "$env" '{name: $n, description: "The \($n) environment (infra/envs/\($n))"}')" | jq -r '.projectId // .id')
  echo "created project $env ($project_id)"
else
  echo "project $env exists ($project_id)"
fi

# Dokploy gives every project one environment (named production by default);
# applications hang off it.
environment_id=$(get "project.one?projectId=$project_id" | jq -r '(.environments // [])[0].environmentId // empty')
[ -n "$environment_id" ] || { echo "project $env has no environment; open it once in the UI" >&2; exit 1; }

# --- application -----------------------------------------------------------
app_id=$(get "environment.one?environmentId=$environment_id" | jq -r '.applications[] | select(.name == "api") | .applicationId' | head -1)
if [ -z "$app_id" ]; then
  app_id=$(post application.create "$(jq -cn --arg env "$environment_id" \
    '{name: "api", appName: "api", description: "The Kuutti API, deployed by deploy.yml from GHCR", environmentId: $env, sourceType: "docker"}')" | jq -r .applicationId)
  echo "created application api ($app_id)"
else
  echo "application api exists ($app_id)"
fi

# The image is public on GHCR; no registry credential ever lives on the box.
post application.saveDockerProvider "$(jq -cn --arg id "$app_id" --arg image "$image" \
  '{applicationId: $id, dockerImage: $image, username: null, password: null, registryUrl: null}')" >/dev/null
echo "image $image"

# Exactly these three lines: everything else comes from SSM through the
# instance role (rules/infra.md), never from Dokploy.
post application.saveEnvironment "$(jq -cn --arg id "$app_id" --arg env "$(printf 'NODE_ENV=production\nAPP_ENV=%s\nPORT=3000' "$app_env")" \
  '{applicationId: $id, env: $env, buildArgs: "", buildSecrets: "", createEnvFile: false}')" >/dev/null
echo "environment NODE_ENV=production APP_ENV=$app_env PORT=3000"

# --- domain ------------------------------------------------------------------
if get "domain.byApplicationId?applicationId=$app_id" | jq -e --arg h "$api_host" '.[] | select(.host == $h)' >/dev/null; then
  echo "domain $api_host exists"
else
  post domain.create "$(jq -cn --arg id "$app_id" --arg host "$api_host" \
    '{applicationId: $id, host: $host, path: "/", port: 3000, https: true, certificateType: "letsencrypt", domainType: "application"}')" >/dev/null
  echo "domain https://$api_host -> 3000 (Let's Encrypt)"
fi

# --- Dokploy's own domain -------------------------------------------------
# Web Server, Server Domain in the UI. The procedure exists in this Dokploy
# version; if a future one renames it, the message says so and the field is
# one click in the UI.
if post settings.assignDomainServer "$(jq -cn --arg host "$dokploy_host" \
  '{host: $host, certificateType: "letsencrypt", letsEncryptEmail: "", https: true}')" >/dev/null 2>&1; then
  echo "Dokploy's own domain https://$dokploy_host"
else
  echo "could not set Dokploy's own domain through the API; set $dokploy_host under Settings, Web Server" >&2
fi

# --- Traefik: pin the control-plane hosts (#9 trust) ----------------------
# A Dokploy member token may attach any host to a preview application; these
# priority routers keep dokploy.<env> and api.<env> with their owners.
app_name=$(get "application.one?applicationId=$app_id" | jq -r .appName)
if [ -n "$app_name" ] && [ "$app_name" != null ] && command -v aws >/dev/null && [ -n "${INSTANCE_ID:-}" ]; then
  file=$(cat <<YAML
# Written by infra/scripts/dokploy-setup.sh; user_data writes the dokploy part at first boot.
http:
  routers:
    control-plane-dokploy:
      rule: Host(\`$dokploy_host\`)
      priority: 1000
      service: dokploy-service-app
      entryPoints: [web]
      middlewares: [redirect-to-https]
    control-plane-dokploy-secure:
      rule: Host(\`$dokploy_host\`)
      priority: 1000
      service: dokploy-service-app
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
    control-plane-api:
      rule: Host(\`$api_host\`)
      priority: 1000
      service: control-plane-api
      entryPoints: [web]
      middlewares: [redirect-to-https]
    control-plane-api-secure:
      rule: Host(\`$api_host\`)
      priority: 1000
      service: control-plane-api
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
  services:
    control-plane-api:
      loadBalancer:
        servers:
          - url: http://$app_name:3000
        passHostHeader: true
YAML
)
  cmd=$(jq -cn --arg f "$file" '{commands: ["cat > /etc/dokploy/traefik/dynamic/00-control-plane.yml <<'"'"'EOF'"'"'", $f, "EOF", "echo written"]}')
  cid=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript --comment "control-plane routers (dokploy-setup.sh)" --parameters "$cmd" --query 'Command.CommandId' --output text)
  for _ in $(seq 1 20); do
    st=$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Success|Failed|TimedOut|Cancelled) break ;; esac
    sleep 3
  done
  echo "Traefik control-plane routers for $dokploy_host and $api_host -> $app_name: $st"
else
  echo "INSTANCE_ID not set or aws missing: control-plane routers not written (see infra/README.md Previews, Trust)" >&2
fi

# --- deploy ----------------------------------------------------------------
post application.deploy "$(jq -cn --arg id "$app_id" --arg d "$image" '{applicationId: $id, title: "dokploy-setup.sh", description: $d}')" >/dev/null
echo "deploying; waiting"
for _ in $(seq 1 120); do
  case "$(get "application.one?applicationId=$app_id" | jq -r '.applicationStatus // "unknown"')" in
    done) echo "deployed"; break ;;
    error) echo "deployment failed; see the Deployments tab" >&2; exit 1 ;;
  esac
  sleep 5
done

cat <<TXT

application id: $app_id
Next, from the repository root:
  gh variable set DOKPLOY_URL --env $env --body https://$dokploy_host
  gh variable set DOKPLOY_APPLICATION_ID --env $env --body $app_id
  gh secret set DOKPLOY_TOKEN --env $env          # prompts; paste the API key
Then every push to main deploys (deploy.yml) and /health must report the commit.
TXT
