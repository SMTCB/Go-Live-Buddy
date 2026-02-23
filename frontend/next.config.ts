import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    // In development, proxy to local backend
    // In production, proxy to Railway backend (set NEXT_PUBLIC_API_URL in Vercel env vars)
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
