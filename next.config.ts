import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone" is disabled on Vercel (Next 16.3 bug #96646 — ENOENT
  // .next/next-server.js.nft.json in onBuildComplete). Standalone is only
  // needed for self-hosted deployment; Vercel handles tracing itself.
  output: process.env.VERCEL ? undefined : "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
