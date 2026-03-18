/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force dynamic rendering for all routes — prevents Next.js from trying to
  // statically collect API route data at build time (which would require a DB connection).
  // API routes are always dynamic by nature; this is belt-and-suspenders.
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.mlbstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'securea.mlb.com',
      },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ['bcryptjs'],
  },
}

module.exports = nextConfig
