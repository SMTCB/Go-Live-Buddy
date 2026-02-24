import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    // Priority: API_URL (server-only, set in Vercel env vars) > NEXT_PUBLIC_API_URL > localhost
    // Set API_URL in Vercel → Project Settings → Environment Variables with your Railway URL.
    // e.g. API_URL = https://your-app.up.railway.app
    const rawUrl =
      process.env.API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://127.0.0.1:8000";

    // Auto-add https:// if user forgot the protocol in the env var
    const backendUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

    console.log(`[next.config] Backend rewrite target: ${backendUrl}`);

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
