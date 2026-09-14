# Vendored Dokploy installer

`dokploy-install.sh` is `https://dokploy.com/install.sh` as fetched on 2026-09-14 (14857 bytes). It is not executed from here: the box downloads the hosted script at first boot and refuses to run it unless its SHA-256 equals this file's (`filesha256` in `../main.tf`), so what runs as root is exactly what was reviewed in this repository.

To bump Dokploy: `curl -fsSL https://dokploy.com/install.sh -o dokploy-install.sh`, read the diff, set `dokploy_version` in `infra/envs/*/variables.tf` to the new release tag, and note that a running box is updated with `sh dokploy-install.sh update`, never by apply. Licence: Apache-2.0, Dokploy contributors.
