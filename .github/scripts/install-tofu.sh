#!/usr/bin/env bash
# Installs the pinned OpenTofu release for the runner's architecture, verified
# against the release's checksum file. No third-party action.
set -euo pipefail
: "${TOFU_VERSION:?}"

case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
base="https://github.com/opentofu/opentofu/releases/download/v$TOFU_VERSION"
archive="tofu_${TOFU_VERSION}_linux_${arch}.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/$archive" "$base/$archive"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/tofu_${TOFU_VERSION}_SHA256SUMS"
(cd "$tmp" && sha256sum --check --ignore-missing --strict SHA256SUMS)
tar -C "$tmp" -xzf "$tmp/$archive" tofu
sudo install -m 0755 "$tmp/tofu" /usr/local/bin/tofu
tofu version
