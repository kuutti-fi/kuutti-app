# Contributing to Kuutti

Thanks for helping. Kuutti is a free, open-source dating app for Finland, run as a non-profit. This page covers the legal and mechanical side of contributing; product and technical decisions live in the project docs and, later, in `docs/adr`.

## Licence

The code is licensed under the GNU Affero General Public License v3.0 (see `LICENSE`) with an additional permission that lets the app be distributed through the Apple App Store and Google Play (see `LICENSE-EXCEPTION`). By contributing, you agree that your contribution is licensed under those same terms, including the additional permission.

We use the Developer Certificate of Origin instead of a contributor licence agreement. You keep your copyright. There is nothing to sign and nothing to send.

## Developer Certificate of Origin (required)

Every commit must carry a `Signed-off-by` line certifying the [Developer Certificate of Origin](DCO). The line states that you wrote the change, or have the right to submit it, under the project licence. Read the `DCO` file once; it is short.

Add the line with the `-s` flag when you commit:

```bash
git commit -s -m "Describe the change"
```

That appends a trailer using your git name and email:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name. A GitHub noreply address is fine if you keep your email private.

A DCO check runs on every push and pull request and fails on any commit without the trailer; a pull request cannot be merged while it fails. To catch it before you push, enable the repository hooks once per clone:

```bash
git config core.hooksPath .githooks
```

If you forgot, sign off after the fact:

```bash
git commit --amend -s --no-edit
```

For several commits on a branch, rebase with sign-off:

```bash
git rebase --signoff main
```

Commits made through the GitHub web editor are signed off automatically.

## Branch and history rules

- `main` is the only long-lived branch. It cannot be deleted or force-pushed.
- History is linear: no merge commits. Pull requests are merged by rebase or squash.
- Dependency updates arrive as Dependabot pull requests.

## Secrets

Never commit credentials, tokens, private keys, or `.env` files. Push protection and a secret scanner run on every push; if either fires, rotate the secret first, then fix the commit.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
