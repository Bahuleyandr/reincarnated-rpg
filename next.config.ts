import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for Fly.io / Docker — bundles a minimal
  // node_modules + server.js into .next/standalone for the runtime
  // image (see Dockerfile).
  output: "standalone",

  // voyageai ships ESM with extension-less internal imports that
  // Turbopack can't always resolve in dev. Treat it as a server-only
  // package so Node handles the require/import at runtime instead of
  // letting the bundler walk into it. The Anthropic SDK is similarly
  // server-only — keep both out of any client bundle path.
  serverExternalPackages: ["voyageai", "@anthropic-ai/sdk"],
};

export default nextConfig;
