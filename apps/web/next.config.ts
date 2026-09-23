import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Load the single .env from the repository root.
 *
 * Next.js reads .env from its own directory, which here is apps/web, but the
 * project keeps one .env at the root so the web app, the worker and the
 * migration scripts all read the same file. Without this, every database
 * variable would be undefined and the app would fail on the first request
 * with a confusing error about a missing DATABASE_URL.
 */
const rootEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const config: NextConfig = {
  // The workspace packages ship TypeScript source rather than a build output,
  // so there is no compile step to keep in sync while developing.
  transpilePackages: ["@stackkeeper/core", "@stackkeeper/db"],
  // Self-hosting target: one container, no platform-specific adapter.
  output: "standalone",
  serverExternalPackages: ["postgres", "pg"],
  poweredByHeader: false,

  // Inlined into the browser bundle at build time. Set explicitly because the
  // value arrives from a .env that Next did not load by itself.
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  },

  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        },
      ],
    },
  ],
};

export default config;
