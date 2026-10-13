# Security

## Reporting a vulnerability

Email **michaelnigusse2@gmail.com** with what you found and how to reproduce
it. Please do not open a public issue.

You will get a reply within three working days. Stackkeeper is maintained
part-time, so a fix may take longer than that, but you will be told where it
stands. You are welcome to be credited in the release notes, or not, as you
prefer.

## What Stackkeeper stores, and what it does not

**It does not store** passwords, SSH keys, API tokens or recovery codes. It
never asks for them. Credential fields hold a reference to an entry in the
user's own password manager, and that is checked three times: in the browser as
it is typed, on the server before it is written, and by a database constraint.

**It does store** client names, provider names, IP addresses, hostnames,
renewal dates and amounts. That is not secret, but it is sensitive: taken
together it is a map of a business's infrastructure, which is exactly what an
attacker would want. The 2022 LastPass breach is the cautionary case, where the
unencrypted part of the stolen data, the website URLs, was itself the damage.

So the baseline matters even though no password is held:

- Two-factor authentication, available from the first release. Passkeys are
  planned; see docs/decisions.md for why they are not in yet.
- Row-level security in Postgres, enabled and forced on every tenant table.
- An application database role that owns nothing and cannot bypass a policy.
- An append-only audit log that the application cannot rewrite or delete.
- Encrypted backups, with restores tested on a schedule.

## The monitor and outbound requests

The monitoring worker connects to hostnames that users supply, which makes it a
tool for reaching things it should not: a database on loopback, a device on the
local network, or a cloud metadata endpoint that hands out credentials.

Every name is resolved first and every address it returns is checked, because a
name under someone else's control can point anywhere. Private, loopback,
link-local, carrier-grade NAT, multicast and reserved ranges are refused, in
IPv4 and IPv6, including IPv4-mapped IPv6 addresses. Only the ports the monitor
genuinely needs may be opened. See `packages/core/src/net-guard.ts` and its
tests.

## Supported versions

Pre-1.0. Fixes go onto `main` and there are no backports yet.
