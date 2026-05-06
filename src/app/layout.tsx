import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import Providers from '@/components/layout/Providers'
import './globals.css'

// Polices chargées et préchargées via next/font/google.
// Variables CSS exposées : --font-body, --font-display, --font-mono
// Référencées dans tailwind.config.ts (fontFamily) et utilisables via les
// classes utilitaires `font-sans` (= body Inter), `font-display`, `font-mono`.
const inter = Inter({
  subsets:  ['latin'],
  weight:   ['400', '500', '600', '700'],
  variable: '--font-body',
  display:  'swap',
})
const jakarta = Plus_Jakarta_Sans({
  subsets:  ['latin'],
  weight:   ['400', '500', '600', '700', '800'],
  variable: '--font-display',
  display:  'swap',
})
const jetbrains = JetBrains_Mono({
  subsets:  ['latin'],
  weight:   ['500', '600'],
  variable: '--font-mono',
  display:  'swap',
})

export const metadata: Metadata = {
  title: 'Verviers Dépannage',
  description: 'Application interne Verviers Dépannage',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VD App',
  },
}

export const viewport: Viewport = {
  themeColor: '#E11D2E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* Anti-FOUC : pose la classe theme-{light|dark} sur <html> AVANT React.
            Lit localStorage('vd_theme'), fallback = 'light' (décision verrouillée). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vd_theme');if(t!=='light'&&t!=='dark')t='light';document.documentElement.classList.add('theme-'+t);}catch(e){document.documentElement.classList.add('theme-light');}})();`,
          }}
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${inter.variable} ${jakarta.variable} ${jetbrains.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
