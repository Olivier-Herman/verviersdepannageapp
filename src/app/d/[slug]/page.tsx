import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { societeParSlug } from '@/lib/espace/clients'
import { getBusinessText } from '@/lib/settings/business'
import ClientApp from './ClientApp'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = await societeParSlug(params.slug)
  return {
    title: s ? `Dépannage — Verviers Dépannage avec ${s.nom}` : 'Verviers Dépannage',
    description: s ? `Commandez votre dépannage Verviers Dépannage, partenaire de votre garage ${s.nom}.` : undefined,
    manifest: s ? `/d/${s.clients_slug}/manifest.webmanifest` : undefined,
    appleWebApp: s ? { capable: true, title: `Dépannage ${s.nom}`, statusBarStyle: 'default' } : undefined,
  }
}
export const viewport: Viewport = { themeColor: '#151a2d', viewportFit: 'cover' }

export default async function Page({ params }: { params: { slug: string } }) {
  const s = await societeParSlug(params.slug)
  if (!s?.clients_slug) notFound()
  const tel = await getBusinessText('telephone_depannage_public').catch(() => '')
  return <ClientApp slug={s.clients_slug} garage={{ nom: s.nom, couleur: s.couleur }} tel={tel} />
}
