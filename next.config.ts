import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  // Skip service worker in dev so HMR isn't intercepted
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Allow LAN access during dev (tablet smoke testing). Next 15+ blocks
  // cross-origin requests to dev resources by default which breaks HMR
  // hydration when serving over the local network.
  allowedDevOrigins: ["192.168.1.101"],
};

export default withSerwist(nextConfig);
