import type { NextConfig } from "next";

// Next.js dev mode compiles the client with webpack's `eval`-based devtool
// (the HMR/runtime chunks call `eval` hundreds of times). A CSP without
// 'unsafe-eval' silently blocks all of it: the page still server-renders, but
// hydration dies, so client components — like the login form — never wire up
// their handlers. Production builds don't use eval, so the exemption is
// development-only and the deployed policy stays strict.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

// The deploy builds into a staging directory and swaps it into place only
// after the build succeeds. `next build` wipes its output directory at the
// start, so building straight into `.next` would delete the assets the live
// server is serving — every deploy would 404 its own chunks mid-build.
// Unset in normal operation: the running server must always read `.next`.
const distDir = process.env.NEXT_DIST_DIR;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(distDir ? { distDir } : {}),
  async rewrites() {
    // Proxy API calls to the backend on :4001 — same-origin, so the httpOnly
    // session cookie set by the API is attached automatically and there is no
    // CORS to configure. (4001, not the more obvious 4000: COPINEX's API also
    // defaults to 4000, and whichever starts first silently wins the port.)
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001"}/api/:path*`,
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
              scriptSrc,
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
