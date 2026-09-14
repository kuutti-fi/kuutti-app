# AWS account setup, click by click

The manual part of issue #6. Everything here is done once, by the maintainer, in a browser and their own terminal. The reasoning is in `infra/README.md` (Account, once) and ADR-001. Expect about an hour, plus the wait for a payment card check.

Nothing in this runbook is typed by an agent: root credentials, card details, phone verification and MFA registration are yours alone.

## 0. The mailbox

There is no project domain mail yet, so the root identity is a dedicated Gmail mailbox created for the project. It is not your personal address and never will be; when the project domain has mail, the root email is changed to the alias in AWS account settings (root sign-in, account menu, Account, Edit next to the account settings, root user email; AWS verifies the new address by code).

1. At accounts.google.com choose Create account, "For my personal use". First name `Kuutti`, last name `AWS`. Username along the lines of `kuutti.aws`; write the exact address down, the rest of this runbook calls it `MAILBOX`.
2. Password: long, random, from the password manager that the association will inherit, stored under a project entry, not a personal one.
3. Recovery phone and recovery email: yours for now. Note them in the same password-manager entry so the association can change them at handover.
4. Security, 2-Step Verification: turn on; register the hardware security key (or a passkey stored in the password manager) and keep the authenticator or backup codes in the entry. Every AWS recovery flow ends in this mailbox, so it is protected at least as well as root.
5. The mailbox is used for nothing else. Gmail delivers plus-addresses to the same inbox, which is how one mailbox serves several roles:

| role | address |
|---|---|
| AWS root user | `MAILBOX` |
| Identity Center user (step 5) | `MAILBOX+admin` |
| alternate contacts (step 3) | `MAILBOX+billing`, `MAILBOX+ops`, `MAILBOX+security` |
| `billing_alert_email` in `infra/bootstrap/terraform.tfvars` | `MAILBOX+billing` |

If a form refuses a `+` address, use the plain `MAILBOX` there and move on; they all land in the same inbox.

## 1. Create the account

At aws.amazon.com choose Create an AWS account and sign in nowhere else during this step.

1. Root user email `MAILBOX`; AWS account name `kuutti`. Verify the code that arrives in the mailbox.
2. Root password: long, random, into the same password-manager entry.
3. Contact information: Business. Organisation name is the association's registered name; address and phone are the association's if it has them, otherwise yours. Agree to the customer agreement.
4. Billing information: the card. AWS makes a small authorisation hold to verify it.
5. Identity confirmation: phone verification by SMS or call.
6. Support plan: Basic (free).
7. **Account plan: Paid account plan.** Not the free plan. The free plan closes after six months or when its credits are spent (TD-19), it blocks some services, and enabling IAM Identity Center in step 5 creates an organisation, which force-upgrades a free-plan account anyway. The USD 100 sign-up credits are lost at step 5 on either plan, so they are not a reason to delay anything.
8. Sign in to the console as root with `MAILBOX` and the new password.

## 2. Secure root

Still signed in as root.

1. Account menu (top right, the account name), Security credentials.
2. Multi-factor authentication, Assign MFA device. Device name `root-hardware-key`, type Passkey or Security Key, Next, touch the key, Continue.
3. Assign a second MFA device the same way (`root-backup`): a second key or a passkey held in the password manager. One lost key must not mean root recovery by phone.
4. On the same page, Access keys must show none. Never create one for root.
5. Sign out and sign in again as root: it must ask for the key. If it does, the password-manager entry is complete: mailbox, root password, both MFA devices.

## 3. Account settings and contacts

Account menu, Account.

1. Alternate contacts, Edit: Billing `MAILBOX+billing`, Operations `MAILBOX+ops`, Security `MAILBOX+security`. Name is the maintainer's, title `Maintainer`, phone the same as at sign-up. AWS sends service and abuse notices here, which is why they are not the root address.
2. Tax settings: leave for the association; AWS charges Finnish VAT until a VAT registration is entered, which an ordinary association does not have.
3. Payment preferences: nothing to change. The paid plan is confirmed when the Billing home page shows no free-plan banner or closure countdown.

## 4. Billing preferences

Billing and Cost Management (search "Billing" in the console).

1. Billing preferences, Alert preferences, Edit: tick Receive CloudWatch Billing Alerts, Save preferences. This is a one-way switch and it is what makes the `AWS/Billing` metric exist; the bootstrap's alarm reads it. About 15 minutes later the metric starts.
2. Nothing else here: the budget, the alarm and the notification topic are code in `infra/bootstrap` and are created by the apply.

## 5. IAM Identity Center

This is the only human login from here on. Root is used again only for billing, account settings, MFA changes and closing the account.

1. Region selector (top right): switch to Europe (Frankfurt) `eu-central-1` before anything else. Identity Center lives in exactly one region and moving it later means deleting and re-creating it.
2. Open IAM Identity Center (search "IAM Identity Center"). Instance configuration: Single-Region instance. Leave the KMS key at the AWS-managed default and Enable multi-account permissions on. Choose Enable.
3. The page "Enable IAM Identity Center with AWS Organizations" appears: it creates an organisation with this account as management account. Creating the organisation expires the USD 100 sign-up credits immediately, on either plan (AWS Free Tier FAQ). That is accepted: the no-static-keys rule is worth more than the credits (ADR-001, admin access). Read the notice, then Enable.
4. Users, Add user. Username `maintainer`; Password: Send an email to this user with password setup instructions; Email `MAILBOX+admin`; first and last name yours; Next. On Add user to groups choose Create group, name `admins`, Create group, close the tab, Refresh, tick `admins`, Next, Add user.
5. Multi-account permissions, AWS accounts. Tick the management account (the only one), Assign users or groups. Step 1: the `admins` group, Next. Step 2: Create permission set (new tab): Predefined permission set, AdministratorAccess, Next; leave the name `AdministratorAccess` and the one-hour session, Next, Create; close the tab, Refresh, tick `AdministratorAccess`, Next. Step 3: Submit. Wait for the account to finish provisioning.
6. Settings, Authentication: Multi-factor authentication, Configure. Prompt users for MFA: Every time they sign in. Users can authenticate with: Security keys and built-in authenticators, and Authenticator apps. If a user does not yet have a registered MFA device: Require them to register an MFA device at sign in. Save.
7. Dashboard: copy the AWS access portal URL (`https://<id>.awsapps.com/start`). It goes into the password-manager entry and into `aws configure sso` below.
8. Sign out of root.
9. In the mailbox, open "Invitation to join IAM Identity Center", Accept invitation, set the user's password (another password-manager entry, `kuutti Identity Center`), and register the hardware key as MFA when prompted. Sign in to the access portal; it shows the `kuutti` account with the `AdministratorAccess` role. Choose the role link once to confirm the console opens.

## 6. The terminal

In your own terminal, never in an agent session. One command does the whole section:

```sh
brew install awscli opentofu && brew install --cask session-manager-plugin
pnpm aws:login
```

The first run writes the SSO profile (`[sso-session kuutti]`, `[profile kuutti]` and `[default]` in `~/.aws/config`, start URL `https://d-99674f16c9.awsapps.com/start`, account `438298963814`, role `AdministratorAccess`, region `eu-central-1`), opens the browser for the access-portal sign-in, then prints the identity and the root check:

```
signed in as arn:aws:sts::438298963814:assumed-role/AWSReservedSSO_AdministratorAccess_.../maintainer
root MFA enabled, root access keys present: 1 0 (want: 1 0)
```

Later runs only sign in again when the eight-hour session has expired. Because `[default]` is the SSO profile, `aws` and `tofu` need no `AWS_PROFILE` in any shell. For a bare `aws-login` on the PATH: `ln -s ~/WebstormProjects/kuutti/infra/scripts/aws-login /opt/homebrew/bin/aws-login`. No file under `~/.aws` ever contains a long-lived credential.

## 7. Hand over to the code

Everything from here is in `infra/README.md`, Bootstrap, run once: fill `infra/bootstrap/terraform.tfvars` (the two GitHub IDs are already there; set `billing_alert_email = "MAILBOX+billing"`), `tofu init`, `tofu apply`, confirm the SNS subscription mail, send the test notification, migrate the state, publish the outputs as repository variables, create the GitHub environments.

## Checklist

- [ ] Mailbox exists, 2-Step Verification on, credentials in the association's password manager
- [ ] Account `kuutti` on the paid plan, no free-plan banner in Billing
- [ ] Root: two MFA devices, zero access keys, sign-in asks for the key
- [ ] Alternate contacts set to the three plus-addresses
- [ ] Receive CloudWatch Billing Alerts ticked
- [ ] Identity Center in eu-central-1, user `maintainer` in group `admins` with `AdministratorAccess`, MFA required every sign-in
- [ ] `aws sts get-caller-identity` works from profile `kuutti`; account summary shows MFA 1, access keys 0
