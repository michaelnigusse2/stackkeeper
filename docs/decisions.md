# Decisions worth remembering

Short notes on choices that are not obvious from the code, and would otherwise
be re-litigated every few months.

## Plain SQL migrations rather than an ORM's schema DSL

The security of this product rests on row-level security, forced policies,
composite foreign keys and a least-privileged role. Those are expressed
precisely in SQL and awkwardly in every schema DSL. Written as SQL, the
migrations can also be applied and tested with `psql` alone, on any machine,
with no `node_modules` — which is how the isolation suite and the mutation
suite run in CI.

Queries are still typed: `packages/db/src/repo/*` returns row interfaces, and
`scripts/check-queries.sh` parses and plans every query against the real schema,
so a renamed column fails the build.

The trade-off is no generated query builder. For a schema of this size, mostly
CRUD plus a few aggregates, that has not been missed.

## Node's built-in test runner rather than Vitest

`node --test` runs TypeScript directly on Node 22. That means `packages/core`
has no dependencies at all, its tests run before anything is installed, and
there is one less tool to upgrade. If a browser-environment test is needed
later, add Vitest for that package alone.

## Two database drivers, on purpose

Better Auth manages its own tables and connects through `pg`. Everything else
uses `postgres` and connects as `stackkeeper_app`. Two drivers is mildly
untidy, but it means the authentication layer and the tenant layer hold
different roles with different privileges, so a flaw in one does not hand over
the other. Better Auth's tables also stay under its own migration CLI, so this
repository never has to track a library's internal column names.

## No desktop application

The original concept called for a Tauri app storing secrets in the OS keychain.
It was dropped before any code was written. Code signing costs money and, for
an individual developer, Microsoft's cheap signing service is limited to the US
and Canada. Secrets would live on one machine. Most decisively, an auto-updater
that touches secrets is itself an attack path: the 2021 Passwordstate breach
was delivered exactly that way.

Referencing the password manager the user already trusts costs nothing to
build, works on every device, and makes "we never store credentials" true with
no qualification.

## Certificate alerts measure lifetime, not days

CA/Browser Forum ballot SC-081v3 takes maximum certificate validity to 100 days
in March 2027 and 47 days in March 2029. Let's Encrypt issues six-day
certificates today and stopped sending expiry emails in June 2025.

A 47-day certificate is inside a 30-day warning window for most of its life, so
absolute thresholds become noise. Stackkeeper warns at 75% of a certificate's
own lifetime and escalates at 90%. Absolute day counts are kept only for
certificates that live longer than 100 days.

## A renewed domain is not a paid domain

Under the `.com` registry agreement an unrenewed domain is auto-renewed by the
registry the day after it expires, then sits in a 45-day grace period during
which the registrar can still delete it. The published expiry date jumps
forward a year and every naive monitor reports green.

Stackkeeper stores the previous expiry date, notices a jump of exactly one year
landing on the old expiry date, and reports *renewal unconfirmed* for 45 days
until a person confirms it. Reporting green there would be the single worst
failure this product could have.

## Some registries publish no expiry date at all

`.de` and `.nl` do not publish one, and `.et` has neither a WHOIS nor an RDAP
server listed with IANA. A manual date field is therefore a first-class part of
the model, not a fallback, and those assets are badged as entered by hand
rather than confirmed upstream.

## The worker is a long-lived process

Reading a certificate needs a TLS handshake, and WHOIS needs port 43. Cloudflare
Workers expose no peer certificate and block connections to Cloudflare's own
address ranges, which is where a large share of monitored sites live. So the
monitor is an ordinary Node process next to the web app, sharing one Postgres
through pg-boss. Two containers and a database is also the whole self-hosting
story.

## One .env at the repository root

Next.js reads `.env` from its own directory, `apps/web`, while the worker and
the migration scripts run from elsewhere. Rather than keep three copies in
sync, there is one `.env` at the root and each entry point loads it explicitly:
`next.config.ts` and `scripts/auth-migrate.mjs` call `process.loadEnvFile`, and
the worker uses `node --env-file-if-exists`.

`NEXT_PUBLIC_APP_URL` is also listed under `env` in `next.config.ts`, because a
variable loaded this way is not picked up by Next's build-time inlining on its
own.

## The Better Auth CLI is its own package

`better-auth migrate` does not exist. The CLI ships as `@better-auth/cli`, so
`pnpm auth:migrate` runs it through `pnpm dlx`. Pin it as a devDependency once
you know which version resolves.

## Passkeys are deferred, not rejected

Better Auth moved the passkey plugin out of the main package. It was imported
as `better-auth/plugins/passkey` up to about 1.3; in 1.7.5, the version this
project installs, that subpath does not exist and neither `passkey` nor
`passkeyClient` appears in the plugin barrels. It now ships separately.

Rather than guess the new package name, passkeys are left out of the first
release. Two-factor authentication covers the security baseline in the
meantime. To add them back: find the current passkey package in the Better
Auth documentation, add it as a dependency, and restore the plugin in
`apps/web/src/lib/auth.ts`, the client plugin in `auth-client.ts`, and the
button on the sign-in page. `PASSKEY_RP_ID` is already reserved in
`.env.example`.
