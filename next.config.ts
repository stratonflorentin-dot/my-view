import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  // Vercel's npm blocks sharp's install script (allowScripts policy) and file
  // tracing misses its bundled libvips — force-include the platform binaries.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@img/**", "./node_modules/sharp/**"],
  },
};

export default nextConfig;
