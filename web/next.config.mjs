import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";

// Full CSP, shipped as Report-Only for now. It follows the Next.js "without
// nonces" recipe (the app is statically rendered, so no per-request nonce):
// Next's inline bootstrap/flight scripts need 'unsafe-inline', and the
// @stacks/connect wallet modal (Stencil web components) injects inline styles.
// connect-src: the Hiro APIs in src/lib/stacks/config.ts (HIRO_API_URLS, also
// the @stacks/network defaults). No WalletConnect/Reown hosts: connect() is
// called without walletConnectProjectId, so WalletConnect is never loaded;
// add wss://relay.walletconnect.org, https://rpc.walletconnect.org,
// https://pulse.walletconnect.org, https://api.web3modal.org and
// frame-src https://verify.walletconnect.org if it is ever enabled.
// Not yet enforced because browser-wallet extensions (Leather, Xverse, ...)
// inject provider scripts into the page and that has not been exercised
// against this policy. Once a real-wallet run shows no violations, rename the
// header to Content-Security-Policy and drop the minimal policy below.
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' https://api.mainnet.hiro.so https://api.testnet.hiro.so",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Enforced now: directives that cannot affect wallet or script loading.
const cspEnforced = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspEnforced },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo root (one level up) also has a package-lock.json (for the
  // Clarity contracts/tests workspace), which made Turbopack infer the wrong
  // workspace root. Pin it explicitly to this directory.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
