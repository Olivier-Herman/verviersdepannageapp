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
import { SITE_URL, TEL, DEPOTS } from './_data'
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
  // Les balises canonical/OG pointent sur le domaine public, jamais sur app.*
  metadataBase: new URL(SITE_URL),
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

// Données structurées : c'est ce qui fait apparaître « Ouvert 24h/24 ·
// 087 35 18 20 » et les dépôts directement dans les résultats Google, avant
// le clic. Une seule entité, ses trois dépôts en lieux, la zone en aire.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'AutoRepair',
  '@id': `${SITE_URL}/#vd`,
  name: 'Verviers Dépannage',
  legalName: 'Verviers Dépannage SA',
  url: SITE_URL,
  logo: `${SITE_URL}/vd-logo.png`,
  telephone: '+32 87 35 18 20',
  email: 'info@verviersdepannage.be',
  vatID: 'BE0460759205',
  priceRange: '€€',
  address: { '@type': 'PostalAddress', streetAddress: 'Rue Lefin 12', postalCode: '4860', addressLocality: 'Pepinster', addressCountry: 'BE' },
  geo: { '@type': 'GeoCoordinates', latitude: 50.5703357, longitude: 5.8216501 },
  openingHoursSpecification: [{
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '00:00', closes: '23:59',
  }],
  areaServed: ['Verviers', 'Spa', 'Theux', 'Pepinster', 'Sprimont', 'Stavelot', 'Malmedy', 'Jalhay', 'Aywaille', 'Dison', 'Herve', 'Eupen', 'Waimes'],
  hasMap: 'https://www.google.com/maps?q=Rue+Lefin+12,+4860+Pepinster',
  department: DEPOTS.map(d => ({
    '@type': 'AutoRepair', name: `Verviers Dépannage — ${d.nom}`,
    address: { '@type': 'PostalAddress', streetAddress: d.adresse[0], addressLocality: d.nom, addressCountry: 'BE' },
    telephone: '+32 87 35 18 20',
  })),
  makesOffer: [
    { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Dépannage et remorquage 24h/24' } },
    { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Fourrière pour les zones de police' } },
    { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Transport de véhicules et couverture d’événements' } },
  ],
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`vdsite ${display.variable} ${body.variable}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Assistant />
    </div>
  )
}
