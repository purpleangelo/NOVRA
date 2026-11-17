import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "pg", "bullmq", "ioredis", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
