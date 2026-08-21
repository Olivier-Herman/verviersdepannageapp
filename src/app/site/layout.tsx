// src/app/site/layout.tsx
//
// Le site public. Il vit dans le même Next que l'app, mais n'en partage rien
// d'autre que le serveur : ses styles sont cloisonnés sous `.vdsite`, ses
// polices lui sont propres, et le middleware ne protège pas /site (sa liste
// est une liste blanche de chemins privés, /site n'y est pas).
//
// Le zoom est réautorisé ici : la racine le coupe pour l'app en kiosque, ce qui
// n'a aucun sens sur une page que quelqu'un lit sur son téléphone au bord de
// la route. Olivier 2026-08-21.

import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google'
import SiteHeader from './_components/SiteHeader'
import SiteFooter from './_components/SiteFooter'
import Assistant  from './_components/Assistant'
import './vd-site.css'

const display = Bricolage_Grotesque({
  subsets: ['latin'], weight: ['600', '800'],
  variable: '--font-site-display', display: 'swap',
})
const body = Instrument_Sans({
  subsets: ['latin'], weight: ['400', '500', '600'],
  variable: '--font-site-body', display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default:  'Verviers Dépannage — dépannage et remorquage 24h/24',
    template: '%s | Verviers Dépannage',
  },
  description:
    'Dépannage et remorquage 24h/24 dans la région verviétoise, les Fagnes et la vallée de l’Amblève. '
  + 'Fourrière police, circuit de Spa-Francorchamps, véhicules à vendre. 087 35 18 20.',
  openGraph: {
    siteName: 'Verviers Dépannage',
    locale:   'fr_BE',
    type:     'website',
  },
}

export const viewport: Viewport = {
  themeColor:   '#D92132',
  width:        'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`vdsite ${display.variable} ${body.variable}`}>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Assistant />
    </div>
  )
}
