import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'sonner'
import ServiceWorker from '@/components/ServiceWorker'

/**
 * Font strategy: CSS custom properties defined in globals.css using system font
 * stacks. This replaces next/font/google which fetches from Google at build time
 * and breaks CI/Docker builds without outbound network access.
 *
 * If you want to restore Google Fonts in a production environment with network
 * access, add NEXT_PUBLIC_USE_GOOGLE_FONTS=true and conditionally import via
 * next/font/google in a client component after hydration. For now, system fonts
 * are correct for reliability.
 */

export const metadata: Metadata = {
  title: { default: 'DINGERS | Fantasy HR League', template: '%s | DINGERS' },
  description: 'Fantasy baseball. One stat. Home runs only.',
  themeColor: '#0a0f1a',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DINGERS',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="font-body bg-surface-0 text-text-primary antialiased min-h-screen">
        {children}
        <ServiceWorker />
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-border)',
              color: 'var(--color-text-primary)',
            },
          }}
        />
      </body>
    </html>
  )
}
