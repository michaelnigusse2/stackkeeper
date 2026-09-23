# Stackkeeper

Stackkeeper keeps track of the servers, domains, certificates and renewals you
maintain for other people, what each one costs you, what the client is charged,
and who actually owns the account.

It exists because of two things that go wrong quietly. A domain lapses and a
client's site disappears. A server gets paid for, month after month, and never
appears on an invoice. Both are invisible until they are expensive.

**Stackkeeper does not store passwords, SSH keys or API tokens, and never asks
for them.** Where a credential exists, it records a reference to the entry in
your own password manager. That is checked in the browser as you type, again on
the server, and once more by a database constraint.

Stackkeeper is open-core. The code is licensed under the
[AGPL-3.0-or-later](LICENSE): run it yourself, change it, or use the paid
hosted version once it exists. See [docs/decisions.md](docs/decisions.md).

## Status

Early, but it does the job it was built for.

| Area | State |
| --- | --- |
| Schema, migrations, tenant isolation | Working, tested |
| Money, margin and unbilled detection | Working, tested |
| Clients, projects, assets, ownership register | Working |
| Credential references and the secret scanner | Working, tested |
| CSV import | Working, tested |
| Domain monitoring: RDAP, WHOIS fallback, manual dates | Working, tested |
| Certificate monitoring, judged on lifetime used | Working, tested |
| Alerts, with email, Slack, Discord and Telegram delivery | Working, tested |
| Renewal reminders at 30, 14 and 3 days from dates you enter | Working, tested |
| Shareable read-only client report links, with expiry and revoke | Working, tested |
| Audit log and activity view | Working |
| Two-factor sign-in (authenticator app, with QR code) | Working, not yet tried in a browser |
| Monthly "what to invoice" CSV export | Working, tested |
| Provider imports, handoff packs, team roles | Not started |

229 unit tests, 15 tenant-isolation assertions against a real Postgres, 11
deliberate breaks of the isolation model that the suite catches, and 73
repository queries parsed against the live schema.

## Running it

Requirements: Node 22.6 or later, pnpm 9 or later, and Postgres 16, or Docker
for the database.

```bash
git clone <your fork> stackkeeper && cd stackkeeper
pnpm install

cp .env.example .env
# Fill in BETTER_AUTH_SECRET: openssl rand -base64 32

docker compose up -d db          # or point .env at your own Postgres
pnpm --filter @stackkeeper/db migrate
pnpm --filter @stackkeeper/web auth:migrate

pnpm dev                         # http://localhost:3000
```

The first sign-up creates a workspace. Import a spreadsheet, or add a client by
hand.

## How it is put together

```
apps/web        Next.js app: clients, assets, costs, import
apps/worker     Long-lived Node process for monitoring (Phase 2)
packages/core   Money, cycles, margin, secret scanning, CSV, validation.
                No dependencies. Pure functions, all tested.
packages/db     SQL migrations, row-level security, typed repositories
```

Three deliberate choices are worth knowing about before reading the code.

**Tenant isolation is in the database, not the application.** Every tenant
table carries `org_id`, has row-level security enabled and forced, and is read
through a transaction that sets `app.org_id` locally. The application connects
as a role that owns nothing and cannot bypass a policy. If a query forgets its
`WHERE` clause, the result is an empty screen, not somebody else's data.
Foreign keys between tenant tables are composite, `(org_id, parent_id)`, so a
child cannot point at another workspace's parent even if the policies were
removed.

**Certificate alerts are relative, not absolute.** Maximum certificate validity
drops to 100 days in March 2027 and 47 days in March 2029, and Let's Encrypt
already issues six-day certificates. A rule that warns "30 days before expiry"
would fire permanently. Stackkeeper warns when a certificate passes three
quarters of its own lifetime without being replaced.

**A renewed-looking domain is not always a paid one.** A registry auto-renews
a `.com` the day after it expires whether or not anyone paid, then holds it in
a 45-day grace period. The published expiry date jumps forward a year and looks
healthy. Stackkeeper reports that as *renewal unconfirmed* rather than green.

**Some registries publish no expiry date at all.** `.de` and `.nl` do not, and
`.et` has neither a WHOIS nor an RDAP server listed with IANA. Those assets
take a date entered by hand and are badged as such, rather than showing a
reassuring blank.

**The worker sees across workspaces, by an explicit policy.** Monitoring is not
done on behalf of one customer, so the worker's database role has a named
cross-organisation policy rather than `BYPASSRLS`, which would silently switch
off every policy on every table. One of the isolation assertions checks that no
such policy is ever attached to the role that serves web requests.

## Verifying a change

```bash
pnpm verify        # types, unit tests, schema, isolation, queries
```

`pnpm test:db` needs a Postgres it can create databases in:

```bash
ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db
```

That runs three things: the tenant isolation suite, a mutation run that breaks
the isolation model eleven ways and checks the suite notices each one, and a
pass that parses every repository query against the real schema.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go to the address in
[SECURITY.md](SECURITY.md), not to the issue tracker.
