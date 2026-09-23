# Start here

Getting Stackkeeper running on your machine, in order. Roughly 20 minutes, most
of it downloads.

## 1. Install these three things

| Tool | Why | Where |
| --- | --- | --- |
| Node 22 or later | Runs everything | https://nodejs.org (LTS) |
| pnpm | Installs the packages | After Node: `corepack enable` |
| Docker Desktop | Runs Postgres so you don't have to install it | https://docker.com/products/docker-desktop |

Check they are all there:

```
node -v      # v22 or higher
pnpm -v      # 9 or higher
docker -v    # any recent version
```

If `pnpm -v` fails after `corepack enable`, close the terminal and open a new
one.

## 2. Install the project

```
cd C:\Users\micha\Desktop\DevJournal\stackkeeper
pnpm install
```

**This is the step most likely to fail.** The package versions were chosen
without access to the npm registry, so one may not exist. If it errors, copy
the whole message and send it over; it is usually a one-line fix.

## 3. Set up your environment file

```
copy .env.example .env
```

Open `.env` and fill in `BETTER_AUTH_SECRET`. In PowerShell:

```
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Paste the result after `BETTER_AUTH_SECRET=`. Leave everything else alone.

## 4. Start the database and build the schema

```
docker compose up -d db
docker compose --profile full run --rm migrate
```

The second command applies the schema from inside a container, so you do not
need Postgres installed on Windows. You should see it apply five migrations.

Then create the login tables:

```
pnpm --filter @stackkeeper/web auth:migrate
```

This downloads Better Auth's command line tool the first time, so give it a
moment. It will tell you which tables it is about to create; say yes.

> Keep `.env` at the top level of the project, not inside `apps/web`. Every
> part of the app is wired to read that one file.

## 5. Run it

```
pnpm dev
```

Open http://localhost:3000.

## 6. Check it actually works

Do these six things in order. They touch every part of the system.

1. Sign up. Name your workspace anything.
2. Add a client called Test Bakery.
3. Add an asset: type Domain, name `testbakery.com`. Set **account owner** to
   *The client* and **pays** to *You*.
4. On the client page, open "Add costs to an asset", pick the domain, enter
   cost `12.00` every **Yearly**, and leave the client charge **blank**.
5. Go to the Dashboard. It should say you are leaking **$1.00** a month, with
   the domain flagged *not billed*.
6. On the client page, open "Add a reference" and paste this into the
   Reference box:

   ```
   -----BEGIN OPENSSH PRIVATE KEY-----
   ```

   It must turn red and refuse before you submit anything. **If this step
   fails, stop and tell me.** It is the product's main promise.

## Running the tests

```
pnpm verify
```

That runs the type checks and 235 unit tests. The database tests need a bit
more:

```
docker compose up -d db
$env:ADMIN_URL="postgres://stackkeeper:stackkeeper@127.0.0.1:5432/postgres"
pnpm test:db
```

These are the ones that prove one workspace cannot see another's data.

## If something breaks

Send me the exact error text. Useful things to include:

- which step number you were on
- the full error, not a summary
- `docker compose logs db` if the database seems to be the problem

Most first-run problems are a missing package version or a typo in `.env`.
Neither takes long to fix.

## One job before the repository goes public

Replace the placeholder `LICENSE` with the official AGPL text:

```
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```
