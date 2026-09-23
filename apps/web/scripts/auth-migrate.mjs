/**
 * Create Better Auth's tables.
 *
 * Two things this handles that a bare CLI call does not:
 *
 *   1. The CLI ships as its own package, @better-auth/cli, not as part of
 *      better-auth. Calling `better-auth` directly fails with "not recognized".
 *   2. It runs from apps/web, but the single .env lives at the repository
 *      root, so the connection string has to be loaded before the CLI starts
 *      or auth.ts throws on a missing AUTH_DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const rootEnv = path.resolve(webDir, "../../.env");

if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
} else {
  console.error(`No .env found at ${rootEnv}`);
  console.error("Copy .env.example to .env at the repository root first.");
  process.exit(1);
}

if (!process.env.AUTH_DATABASE_URL && !process.env.DATABASE_ADMIN_URL) {
  console.error("Neither AUTH_DATABASE_URL nor DATABASE_ADMIN_URL is set in .env");
  process.exit(1);
}
if (!process.env.BETTER_AUTH_SECRET) {
  console.error("BETTER_AUTH_SECRET is empty in .env. Generate one and paste it in.");
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["dlx", "@better-auth/cli@latest", "migrate", "--config", "src/lib/auth.ts"],
  {
    cwd: webDir,
    stdio: "inherit",
    // Windows needs a shell to resolve pnpm's .cmd shim.
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
