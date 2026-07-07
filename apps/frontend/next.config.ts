/**
 * next.config.ts
 *
 * Next.js configuration for DocuMind AI (frontend).
 *
 * SECURITY HEADERS:
 *  Set here via the headers() async function so they are applied at the
 *  CDN/edge layer by Vercel, not just at the application level.
 *  This means they're present even on static assets and API routes.
 *
 * SOURCES / RATIONALE:
 *  https://nextjs.org/docs/app/api-reference/next-config-js/headers
 *  https://securityheaders.com
 *  https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
 */

import type { NextConfig } from 'next';

const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
const SUPABASE_URL    = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

/**
 * Content-Security-Policy string.
 *
 * WHY EACH DIRECTIVE:
 *  default-src 'self'        — fallback: only load resources from our origin
 *  script-src  'self'        — no inline scripts, no CDN scripts
 *                              Add 'unsafe-inline' only if you use React's
 *                              dangerouslySetInnerHTML (avoid if possible)
 *  style-src   'self' 'unsafe-inline'
 *                            — Next.js injects critical CSS inline; unsafe-inline
 *                              is required. Acceptable trade-off with SRI hashes.
 *  img-src     'self' data: blob: https:
 *                            — data: for base64 document previews, blob: for
 *                              object URLs, https: for Supabase Storage CDN
 *  font-src    'self'        — self-hosted fonts only
 *  connect-src 'self' + API  — fetch() and WebSocket targets (backend + Supabase)
 *  object-src  'none'        — block Flash / Java applets
 *  base-uri    'self'        — prevent <base> tag injection
 *  frame-ancestors 'none'   — equivalent to X-Frame-Options: DENY (CSP level)
 *  form-action 'self'        — forms only POST to our own origin
 *  upgrade-insecure-requests — browser upgrades http:// to https:// automatically
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' ${BACKEND_API_URL} ${SUPABASE_URL} https://api.groq.com wss:`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  // ── Strict-Transport-Security (HSTS) ──────────────────────────────────────
  // Forces browsers to use HTTPS for 1 year. includeSubDomains covers all
  // subdomains. preload opts in to being hard-coded into Chrome/Firefox.
  // Do NOT set this on localhost/dev — it will break HTTP access.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },

  // ── X-Frame-Options ───────────────────────────────────────────────────────
  // DENY prevents this page from being embedded in any iframe.
  // Protects against clickjacking attacks (legacy header; CSP frame-ancestors
  // is the modern equivalent, but include both for maximum browser compat).
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },

  // ── X-Content-Type-Options ────────────────────────────────────────────────
  // Prevents browsers from MIME-sniffing a response away from the declared
  // Content-Type. Without this, a browser might execute a .txt file as JS.
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },

  // ── Referrer-Policy ───────────────────────────────────────────────────────
  // When navigating from DocuMind to an external site, only send the origin
  // (not the full URL path which may contain document IDs or query strings).
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },

  // ── Permissions-Policy ────────────────────────────────────────────────────
  // Explicitly opt out of browser APIs that DocuMind AI doesn't need.
  // Prevents malicious third-party scripts from silently accessing
  // camera/microphone/location even if they somehow load on the page.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  },

  // ── Content-Security-Policy ───────────────────────────────────────────────
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },

  // ── X-DNS-Prefetch-Control ────────────────────────────────────────────────
  // Disable DNS prefetching for external links to prevent information leakage.
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'off',
  },
];

const nextConfig: NextConfig = {
  // Apply security headers to every route (/* matches everything)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  // Strict mode: catches deprecated React patterns and double-renders
  // in development to help find side effects.
  reactStrictMode: true,

  // Only allow images from our own origin and Supabase Storage.
  // Prevents hotlinking and SSRF via the Next.js Image component.
  images: {
    remotePatterns: [
      ...(SUPABASE_URL
        ? [
            {
              protocol: 'https' as const,
              hostname: new URL(SUPABASE_URL).hostname,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;

