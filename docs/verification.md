# What has been verified, and what has not

This code was written in a sandbox where the npm registry was blocked, so
`pnpm install` never ran. Anything that needs a third-party package installed
could not be executed. Postgres 16 *was* available, and Node 22 runs TypeScript
directly, so a large part of the project was genuinely run rather than merely
written.

This file is the honest split. Read it before trusting anything below.

## Verified by running it

| What | How | Result |
| --- | --- | --- |
| Migrations | Applied to a live Postgres 16 from empty | 4 of 4 apply cleanly |
| Tenant isolation | `scripts/test-rls.sh` against a real database, as the unprivileged role | 14 assertions pass |
| The isolation tests are not vacuous | `scripts/test-rls-mutations.sh` breaks the model 9 ways | All 9 breaks caught |
| Every repository query | `scripts/check-queries.sh` runs `PREPARE` against the real schema | 65 of 65 parse and plan |
| That query check is not vacuous | A column name was misspelled on purpose | Caught |
| `packages/core` | `node --test` | 144 tests pass |
| `packages/db` encryption | `node --test` | 15 tests pass |
| `apps/worker` logic | `node --test` | 51 tests pass |
| `packages/core` types | `tsc --noEmit` | Clean |
| Every package's types, including `apps/web` | `tsc --noEmit` against the installed packages, 23 Sep 2026 | Clean |
| Cross-package imports | `scripts/check-imports.py` | 181 symbols, all exported |
| Erasable syntax | Every `.ts` loaded through Node's type stripper | All strippable |

What the 210 unit tests actually cover, beyond arithmetic: RDAP and WHOIS
parsing against real response shapes, registrable-domain resolution including
multi-level suffixes and punycode, wildcard certificate matching, the
lifetime-based alert thresholds, the registry auto-renew trap, the private
address ranges the monitor must refuse, per-host rate limiting and back-off,
CSV quoting and delimiter detection, the secret scanner's true and false
positives, and AES-GCM sealing including tamper detection.

Two real bugs were found this way and fixed:

1. Expiry thresholds were listed descending, so `find` returned the widest
   threshold a domain had crossed rather than the tightest. A domain due in 20
   days reported "60 days" instead of "30 days".
2. A constructor used TypeScript parameter properties, which Node cannot strip,
   so the worker would not have started.

## Not verified, because nothing could be installed

Everything below is written with care but has never been executed. Treat the
first run as a debugging session, not a smoke test.

- **`apps/web` entirely.** Next.js, React and Better Auth were all written
  against their documented APIs without being compiled or run.
- **Better Auth configuration** in `apps/web/src/lib/auth.ts`, including the
  organisation and two-factor plugins, and its migration CLI. The plugin import
  paths *have* since been checked against the installed 1.7.5 package; the
  configuration they receive has not been run.
- **`postgres` (porsager) usage** in `packages/db/src/sql.ts`. The SQL itself is
  verified; the driver calls around it are not.
- **pg-boss wiring** in `apps/worker/src/index.ts`.
- **The Dockerfiles and `docker-compose.yml`.**
- **Version numbers** in every `package.json`. They were chosen from knowledge
  that predates this build, and the registry could not be consulted. Expect to
  adjust at least one.

## First run on your machine

Work through this in order. Each step tells you what "working" looks like.

```bash
pnpm install
```
*Expect to fix a version range or two here. That is the step most likely to
fail, and the cheapest to fix.*

```bash
pnpm verify
```
*Should reproduce everything in the table above, plus a full typecheck of the
web app. The typecheck is the first real test of the unverified code; fix what
it reports before running anything.*

```bash
cp .env.example .env
# BETTER_AUTH_SECRET: openssl rand -base64 32
docker compose up -d db
pnpm --filter @stackkeeper/db migrate
pnpm --filter @stackkeeper/web auth:migrate
```
*The auth migration is where a Better Auth API mismatch would show up.*

```bash
pnpm dev
```

Then walk this path, which touches every layer:

1. Sign up, create a workspace.
2. Add a client.
3. Add a domain to it, set the owner to the client and the payer to you.
4. Record a cost of 12.00 a year with no charge.
5. The dashboard should show 1.00 a month leaking, flagged as not billed.
6. Import a small CSV and check the column guesses.
7. Paste a fake private key into a credential reference. It must be refused in
   the browser, before the form is submitted.

If step 7 fails, stop and fix it before anything else. It is the product's
central promise.

## Worth doing before the repository goes public

- Replace `LICENSE` with the official AGPL text:
  `curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE`
- Put a real address in `SECURITY.md` and serve it from
  `/.well-known/security.txt`.
- Re-check the competitor and market figures in the implementation plan. They
  were gathered on 20 September 2026 and a planned fact-check pass never ran.

## Found on the first real run

Things that only surfaced once the packages were actually installed, kept here
so the same ground is not covered twice:

1. `better-auth migrate` is not a command. The CLI is a separate package,
   `@better-auth/cli`, now invoked through `apps/web/scripts/auth-migrate.mjs`.
2. Nothing loaded the root `.env`. Next.js reads `.env` from `apps/web`, not
   from the repository root, so `next.config.ts` and the auth migration script
   now call `process.loadEnvFile` explicitly and the worker uses
   `--env-file-if-exists`.
3. pg-boss 10 refuses to schedule onto a queue that has not been created.
   `boss.work()` does not create one; `boss.createQueue()` does, and it is
   idempotent, so the worker now declares every queue on start.
4. Signing in creates a session with no active organisation. The organisation
   plugin only sets one when something calls `setActiveOrganization`, so a
   returning user was sent through onboarding and made a duplicate workspace
   every time, with their existing records apparently gone. `requirePrincipal`
   now adopts the oldest membership, and onboarding refuses to run for anyone
   who already has a workspace.
5. `better-auth/plugins/passkey` does not exist in 1.7.5. Verified against the
   installed package's export map: passkey has moved to its own package, so the
   plugin was removed rather than guessed at. `organization` and `twoFactor`
   were checked the same way and are correct.

## Added in the second build

The monitoring engine, the missing screens and the redesign. Verified the same
way: the pure logic is tested here, the network and framework layers are not.

**Tested:** RDAP response parsing, WHOIS field extraction, bootstrap lookup and
the table of registries missing from it, certificate summarising and wildcard
matching, the check-to-alert pipeline for both kinds, monitor planning from an
asset, alert wording, and envelope encryption.

**Not tested here, because it needs a network or a browser:** the TLS handshake
itself, live RDAP and WHOIS requests, pg-boss job execution, notification
delivery to Slack, Discord, Telegram and Resend, and every screen.

**Worth watching on the first run:**

- The worker needs `DATABASE_ADMIN_URL` to be the role that ran the migrations,
  because migration 0004 attaches the cross-organisation policies to whoever
  that was.
- `STACKKEEPER_SECRET_KEY` falls back to `BETTER_AUTH_SECRET`. If you later set
  it separately, any webhook secret sealed before that becomes unreadable and
  must be re-entered.
- The exchange-rate endpoint is a third party whose response shape was not
  verified. A failure there is logged and skipped; margins still work whenever
  cost and charge share a currency.

## The date bug, and the check that came out of it

A `Date` rendered into JSX throws "Objects are not valid as a React child",
and it only shows up for the rows that happen to carry a value. One surfaced
on the monitors page. Looking for others turned up a second, worse one.

Four Postgres `date` columns were typed as `string | null` in the repository
layer, but the driver returns them as `Date` objects: `next_renewal`,
`started_on`, `ended_on` and `manual_expires_at`.

- `manual_expires_at` was rendered directly, which threw.
- `started_on` and `ended_on` were compared with `<` against an ISO string in
  `isLineActive`. JavaScript coerces the Date to a number and the string to
  `NaN`, every comparison is false, and **a cancelled service went on counting
  toward margin for ever**. Silent, and worse than the crash.

Fixed at three levels: the types now say `Date | string | null`, `toIsoDate`
normalises on the way out of the database, and `isLineActive` accepts either
shape. Three regression tests cover it.

`scripts/check-render-safety.py` now scans every JSX interpolation in `apps/`
for a `date`, `timestamptz` or `jsonb` field rendered without a formatter. It
was checked against both shapes of the original bug, and runs in CI as
`pnpm check:render`.

### Closing the rest of the class

The render checker only sees JSX. The margin bug was not in JSX, so the same
sweep would have missed it a second time. `scripts/check-date-logic.py` covers
the other half: any value carrying a date that reaches `<`, `>`, `<=`, `>=`,
`===`, `!==` or `+` without first passing through a normaliser.

It is quiet on purpose. Comparisons that cannot have this bug are not
reported: null checks, anything inside a SQL template (Postgres compares real
date types itself), a field name appearing inside a string literal, a
`typeof x === "string"` guard, and a local already normalised further up the
file. Getting to zero noise took three passes; a checker that prints sixteen
non-problems is one nobody runs.

Checked against the bug it exists to prevent, the way the isolation suite is:

- the real `isLineActive` bug, reintroduced verbatim -- caught
- a raw `next_renewal` compared against an ISO string -- caught
- a date field concatenated into a label with `+` -- caught
- the unmodified tree -- clean

Two further findings came out of the same sweep, both in the checking layer
rather than the product:

- `extract-queries.py` resolved its source directories against the current
  directory, and skipped a directory that did not exist. Run from the
  repository root -- which is exactly how CI invokes it -- it found no
  queries. It now anchors to its own location, and refuses to run at all if a
  source directory is missing rather than quietly checking nothing.
- Its tag pattern could not match `sql<Array<{ n: number }>>`, because a
  non-greedy `<...>` stops at the first `>` and never reaches the template.
  Two live worker queries had therefore never been checked against the schema.
  Angle brackets are now counted rather than matched, coverage is 63 of 63
  SQL templates in the tree, and all 63 parse.

The query checker was itself checked for teeth: a deliberately misspelled
column is rejected by `PREPARE`.
