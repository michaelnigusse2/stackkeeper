# Contributing

Thank you for looking. Stackkeeper is maintained part-time, so the fastest way
to get a change merged is to make it easy to review.

## Before you start

Open an issue for anything beyond a small fix. A short description of the
problem you hit is more useful than a patch that solves a different one.

## Getting set up

```bash
pnpm install
cp .env.example .env            # fill in BETTER_AUTH_SECRET
docker compose up -d db
pnpm --filter @stackkeeper/db migrate
pnpm --filter @stackkeeper/web auth:migrate
pnpm dev
```

## Before you open a pull request

```bash
pnpm verify
```

Everything must pass. If you changed the schema, `pnpm test:db` needs a
Postgres it can create databases in:

```bash
ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:db
```

## House rules

**Migrations are immutable.** Once a migration has been applied it is never
edited; the runner compares checksums and refuses. Add a new numbered file.

**Every tenant table needs row-level security.** Enabled *and* forced, with a
policy comparing `org_id` to `app.current_org()`. One of the isolation tests
walks the schema looking for a table that carries `org_id` without this, so a
table added without a policy fails CI rather than leaking in production.

**Foreign keys between tenant tables are composite.** `(org_id, parent_id)`
referencing `(org_id, id)`, never `parent_id` alone. This is the second line of
defence and it holds even if a policy is dropped.

**Never store a secret.** Passwords, SSH keys and API tokens do not belong in
this database in any form, encrypted or not. Features that need one should
reference the user's password manager. If you think you have found a case that
genuinely needs an exception, open an issue before writing code.

**Money is integer minor units plus a currency code.** Never a float. Divide in
the fractional space that `@stackkeeper/core` provides and round once, at the
end, so a total equals the sum of its rows.

**Prefer the standard library.** Tests use Node's built-in runner. Validation
and CSV parsing are a few hundred lines in `packages/core` rather than
dependencies. A part-time maintainer pays for every package in upgrade work, so
a new dependency needs a reason in the pull request description.

## Where the risk is

Review these by hand, carefully, whether they were written by a person or with
AI assistance:

- anything in `packages/db/migrations/0002_rls.sql`
- `apps/web/src/lib/session.ts`, which decides whose data is loaded
- `packages/core/src/secret-scan.ts`, which keeps the product's main promise
- `apps/worker/src/resolve.ts`, which stops the monitor being pointed at
  private networks

Elsewhere, ordinary review is fine.

## Style

TypeScript, strict mode. No `enum` and no constructor parameter properties:
Node runs this source directly by stripping the types, and neither of those can
be stripped. The `erasableSyntaxOnly` compiler option enforces it.

Comments should say why, not what. If a line needs a comment to explain what it
does, rename something instead.
