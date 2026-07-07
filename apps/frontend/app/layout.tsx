/**
 * app/layout.tsx — Root layout (Server Component)
 *
 * Reads the per-request nonce injected by middleware.ts and passes it
 * to Next.js via the <head> so that framework-generated inline scripts
 * receive the correct nonce attribute and are allowed by our strict CSP.
 *
 * The `headers()` import from 'next/headers' makes this a dynamic route —
 * it opts out of static generation. That's intentional: CSP nonces must
 * be unique per request (a static nonce defeats the purpose entirely).
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DocuMind AI — Ask Your Documents',
  description: 'Upload documents and get AI-powered answers instantly',
  icons: {
    icon: '/favicon.ico',
    apple: '/logo.png',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the nonce that middleware.ts set on the incoming request headers.
  // This is the same nonce that was written into the Content-Security-Policy
  // response header for this request.
  const headersList = await headers();
  const nonce = headersList.get('x-nonce') ?? '';

  return (
    <html lang="en">
      {/*
        Next.js reads the `nonce` prop on <head> and automatically applies it
        to any inline <script> tags it injects (hydration bootstrap, etc.).
        Without this, those scripts are blocked by script-src 'nonce-...' CSP.
      */}
      <head nonce={nonce} />
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        {children}
      </body>
    </html>
  );
}

