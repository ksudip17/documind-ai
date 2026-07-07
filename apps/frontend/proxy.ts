/**
 * proxy.ts — Next.js 16 Edge Proxy
 *
 * Replaces the deprecated middleware.ts convention (renamed in Next.js 16).
 * https://nextjs.org/docs/messages/middleware-to-proxy
 *  Next.js injects inline <script> tags for its runtime bootstrap and
 *  hydration logic. These change every build, so you can't predict their
 *  SHA-256 hashes in a static config. The two legitimate options are:
 *
 *  1. 'unsafe-inline'  — allows ALL inline scripts (defeats CSP for XSS)
 *  2. nonce-based CSP  — allows only inline scripts that carry the correct
 *                        one-time random token generated per request.
 *                        This is what we implement here.
 *
 * HOW IT WORKS:
 *  1. Middleware generates a cryptographically random nonce per request.
 *  2. The nonce is injected into the CSP header: script-src 'nonce-<value>'.
 *  3. The nonce is forwarded to the React tree via the 'x-nonce' request
 *     header so layout.tsx can read it with next/headers and attach it
 *     to the <script> tag Next.js renders.
 *  4. Next.js only executes inline scripts that carry the matching nonce.
 *  5. An attacker-injected script has no nonce → blocked by the browser.
 *
 * 'strict-dynamic':
 *  Allows scripts loaded by a nonced script to also run (Next.js loads
 *  chunks this way). Without it, only the initial bootstrap script runs.
 *
 * IMPORTANT — Do NOT set CSP in next.config.ts headers() when using this
 *  middleware. next.config.ts headers are static (set at build time) and
 *  can't include a per-request nonce. This middleware replaces that.
 *  The other non-CSP headers (HSTS, X-Frame-Options, etc.) stay in
 *  next.config.ts because they don't need to be dynamic.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Hosts that the frontend needs to connect to
const API_URL      = process.env.NEXT_PUBLIC_API_URL      || 'http://localhost:5001';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export function proxy(request: NextRequest) {
  // Generate a fresh random nonce for every request.
  // crypto.randomUUID() is available in the Edge runtime.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Build the CSP header string.
  // Each directive is on its own line for readability; we collapse whitespace below.
  const csp = [
    // Fallback for any resource type not explicitly listed
    `default-src 'self'`,

    // Scripts: only self-hosted bundles + scripts carrying this request's nonce.
    // 'strict-dynamic' propagates trust to scripts loaded by a trusted script
    // (Next.js lazy-loads route chunks this way — without this they'd be blocked).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,

    // Styles: Next.js injects critical CSS via <style> tags (no nonce support yet).
    // 'unsafe-inline' is acceptable here because style injection XSS is low-risk
    // compared to script injection — styles can't exfiltrate data or run logic.
    `style-src 'self' 'unsafe-inline'`,

    // Images: self + base64 data URIs (doc previews) + blob: (object URLs) + CDN
    `img-src 'self' data: blob: https:`,

    // Fonts: Inter is loaded via next/font (self-hosted), no external CDN needed
    `font-src 'self'`,

    // Fetch / XHR / WebSocket targets
    `connect-src 'self' ${API_URL} ${SUPABASE_URL} https://api.groq.com wss:`,

    // Block legacy plugin content (Flash, Java applets)
    `object-src 'none'`,

    // Prevent <base href="..."> injection (could redirect relative URLs to attacker)
    `base-uri 'self'`,

    // Prevent this page from being loaded in any <iframe> (clickjacking)
    `frame-ancestors 'none'`,

    // Forms only allowed to POST to our own origin
    `form-action 'self'`,

    // Browser upgrades any http:// sub-resources to https:// automatically
    `upgrade-insecure-requests`,
  ].join('; ');

  // Clone the request headers and inject the nonce so layout.tsx can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // Build the response, forwarding the modified request headers
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Set the CSP on the response (what the browser actually enforces)
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

/**
 * Matcher — which routes this proxy runs on.
 *
 * EXCLUDES:
 *  - _next/static  — static asset files (JS/CSS bundles); no HTML, no CSP needed
 *  - _next/image   — Next.js image optimisation endpoint
 *  - favicon.ico   — browser favicon request
 *
 * The 'missing' condition prevents the proxy from running on Next.js
 * internal prefetch requests (they don't render HTML, so CSP is irrelevant).
 */
export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
