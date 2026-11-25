import type { NextConfig } from "next";

const firebaseAuthDomain =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
  "hybridailearning.firebaseapp.com";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseAuthDomain}/__/auth/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
