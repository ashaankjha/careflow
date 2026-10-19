import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "node:path";

// Load the monorepo root .env (DATABASE_URL etc.)
config({ path: resolve(process.cwd(), "../../.env") });

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  transpilePackages: ["@careflow/core", "@careflow/db", "@careflow/connectors"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        // Content-Security-Policy is set per request (with a nonce) in src/middleware.ts.
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
