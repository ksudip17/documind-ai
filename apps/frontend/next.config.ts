/**
 * next.config.ts
 *
 * Next.js configuration for DocuMind AI (frontend).
 *
 * SECURITY HEADER SPLIT:
 *  This file sets STATIC security headers — values that don't change per request.
 *  CSP is intentionally NOT set here. It is handled by middleware.ts instead,
 *  because CSP requires a per-request cryptographic nonce to allow Next.js's
 *  inline scripts. A static nonce in next.config.ts would be the same for every
 *  user, defeating the entire purpose of nonce-based CSP.
 *
 *  Headers set here:  HSTS, X-Frame-Options, X-Content-Type-Options,
 *                     Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control
 *  Headers set in middleware.ts: Content-Security-Policy (with per-request nonce)
 */

import type { NextConfig } from 'next';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

/**
 * Static security headers applied to every route.
 * CSP is intentionally absent — see middleware.ts.
 */
const securityHeaders = [
  // ── Strict-Transport-Security (HSTS) ────────────────────────────────────
  // Forces browsers to use HTTPS for 1 year.
  // includeSubDomains covers all subdomains. preload opts into browser lists.
  // Do NOT set this for localhost — it permanently breaks HTTP access.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },

  // ── X-Frame-Options ─────────────────────────────────────────────────────
  // Legacy clickjacking protection (CSP frame-ancestors is the modern equiv,
  // but include both for maximum browser compatibility).
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },

  // ── X-Content-Type-Options ───────────────────────────────────────────────
  // Prevents MIME sniffing — browser executing a .txt file as JavaScript.
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },

  // ── Referrer-Policy ─────────────────────────────────────────────────────
  // Only send the origin (not the full URL path) in the Referer header when
  // navigating to external sites. Prevents document IDs from leaking.
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },

  // ── Permissions-Policy ──────────────────────────────────────────────────
  // Opt out of browser APIs DocuMind AI doesn't need.
  // Prevents malicious scripts from silently accessing hardware APIs.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  },

  // ── X-DNS-Prefetch-Control ───────────────────────────────────────────────
  // Prevents information leakage via DNS prefetch on external links.
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'off',
  },
];

const nextConfig: NextConfig = {
  // Apply static security headers to every route
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  // Strict mode catches deprecated React patterns and side effects early.
  reactStrictMode: true,

  // Only allow images from our own origin and Supabase Storage CDN.
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


