import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
