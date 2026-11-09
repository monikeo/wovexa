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
