import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // API proxying is handled at request-time by:
  // src/app/api/[...path]/route.ts → Railway backend
  // This avoids baking the backend URL at build time.
};

export default nextConfig;

