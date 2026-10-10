import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy API calls to the backend on :4000 — same-origin, so the httpOnly
    // session cookie set by the API is attached automatically and there is no
    // CORS to configure.
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // All routes: harden the browser-facing surface.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          {
            key: "Content-Security-Policy",
            // 'unsafe-inline' for script/style is required by Next.js hydration
            // without a nonce middleware (documented upgrade path: nonces).
            // connect-src 'self' keeps injected scripts from calling home — and
            // the session lives in an httpOnly cookie, so there is no token in
            // JavaScript worth exfiltrating at all.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
