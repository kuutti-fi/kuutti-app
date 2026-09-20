# Kuutti

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kuutti-fi/kuutti-app/badge)](https://scorecard.dev/viewer/?uri=github.com/kuutti-fi/kuutti-app)

A free, open-source dating app for Finland. No ads, no premium tiers, no data sales. Every account is a real adult verified through Finnish bank identification. Run by a non-profit association, built as a hobby by volunteers, with research partners onboard.

Milestone 1 (the skeleton) is in progress: a Hono API on AWS (`infra/`), an Expo app (`apps/mobile`), a moderation panel (`apps/admin`), shared contracts and database packages, and the CI that deploys staging on every merge. `CLAUDE.md` carries the standing rules, `docs/adr/` the decisions, `CONTRIBUTING.md` the fifteen-minute local setup.

## Licence

AGPL-3.0 with App Store exception.

The code is licensed under the GNU Affero General Public License, version 3, see [LICENSE](LICENSE), with an additional permission under section 7 that allows distribution through app stores whose terms conflict with the AGPL, see [LICENSE-EXCEPTION](LICENSE-EXCEPTION).

The licence covers the code, not the name or the look: a fork needs its own name and emblem, see [TRADEMARKS.md](TRADEMARKS.md). Whoever runs the code as a service offers its source to the users of that service (AGPL section 13): the API names it in `GET /health` (`source`, with the running `commit`), and the app and the moderation panel show both. A modified deployment sets `SOURCE_URL` to its own repository.

Dependencies stay within the licences listed in [scripts/license-policy.json](scripts/license-policy.json), so that nothing copyleft without an equivalent store permission ends up in the app (`pnpm check:licenses`).

## Contributing

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are accepted under the Developer Certificate of Origin. Every commit needs a `Signed-off-by` line, added with `git commit -s`. Details in [CONTRIBUTING.md](CONTRIBUTING.md) and the [DCO](DCO) file.

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
