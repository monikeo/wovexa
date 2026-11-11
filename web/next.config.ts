import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // The 3D model library (models, their 2D views, subfolders) ships with the server that lists
  // and serves it (src/app/api/models).
  outputFileTracingIncludes: {
    '/api/models': ['./3d_models/**/*'],
    '/api/models/\\[...path\\]': ['./3d_models/**/*'],
  },
  turbopack: {
    // Pin the workspace root so stray lockfiles in parent folders are ignored.
    root: path.join(__dirname),
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // The parts of a content security policy that cost nothing: no plugins, no <base> that
          // repoints relative links, no framing, and forms that post only here. Scripts aren't
          // restricted: that needs a nonce per request, which statically prerendered pages can't carry.
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
        ],
      },
      {
        // The service worker must always be revalidated so updates reach users (spec PWA-08).
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
