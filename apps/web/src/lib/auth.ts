import { betterAuth } from "better-auth";
import { organization, twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

/**
 * Authentication.
 *
 * Better Auth owns its own tables, created by its migration CLI:
 *
 *     pnpm --filter @stackkeeper/web auth:migrate
 *
 * They are deliberately not part of this project's SQL migrations, so that the
 * schema this repository maintains never has to track a library's internal
 * column names.
 *
 * This pool uses AUTH_DATABASE_URL, a different role from the one that serves
 * tenant queries. Two-factor authentication is on from the first release
 * because the product holds a map of its customers' infrastructure: client
 * names, providers and IP addresses are a target list even though no password
 * is stored here.
 *
 * Passkeys are not wired up yet. They shipped inside better-auth until 1.3 and
 * are a separate package from 1.7, so the plugin is left out rather than
 * guessed at. See docs/decisions.md.
 */

const authDatabaseUrl = process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_ADMIN_URL;
if (!authDatabaseUrl) {
  throw new Error("AUTH_DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  throw new Error(
    "BETTER_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32",
  );
}

export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: new Pool({ connectionString: authDatabaseUrl, max: 5 }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  plugins: [
    organization({
      // A workspace per agency. One person's clients are never another's.
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 50,
    }),
    twoFactor({
      // The name authenticator apps show next to the code.
      issuer: "Stackkeeper",
    }),
  ],
});

export type Auth = typeof auth;
