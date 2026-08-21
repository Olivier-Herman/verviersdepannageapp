// src/app/site/vente/[ref]/page.tsx
//
// Fiche d'un véhicule en vente, adressée par sa référence (VD-2026-014) plutôt
// que par son id : c'est ce qu'on peut lire au téléphone. Un lot clôturé reste
// consultable le temps de l'attribution, mais n'accepte plus d'offre.

import { notFound } from 'next/navigation'
import Link         from 'next/link'
import { createAdminClient } from '@/lib/supabase'
import {
  PUBLIC_COLUMNS, publicBidSummary, minimumBid,
  SALE_CONDITIONS, SALE_DESTINATIONS,
  type SaleMode, type BidStatus,
} from '@/lib/ventes/types'
import { TEL } from '../../_data'
import Countdown from '../../_components/Countdown'
import Gallery   from '../../_components/Gallery'
import BidForm   from '../../_components/BidForm'

export const dynamic = 'force-dynamic'

const eur = (n: number) => n.toLocaleString('fr-BE') + ' €'

async function load(ref: string) {
  const sb = createAdminClient()
  const { data } = await sb.from('vehicle_sales')
    .select(PUBLIC_COLUMNS)
    .eq('reference', decodeURIComponent(ref).toUpperCase())
    .maybeSingle()
  if (!data || !['published', 'closed'].includes((data as any).status)) return null

  const { data: bids } = await sb.from('vehicle_sale_bids')
    .select('amount, status').eq('sale_id', (data as any).id)
  return { sale: data as any, bids: (bids || []) as { amount: number; status: BidStatus }[] }
}

export async function generateMetadata({ params }: { params: { ref: string } }) {
  const found = await load(params.ref)
  if (!found) return { title: 'Véhicule introuvable' }
  const { sale } = found
  return {
    title: sale.title,
    description: [
      sale.title,
      sale.mileage != null ? `${sale.mileage.toLocaleString('fr-BE')} km` : null,
      SALE_CONDITIONS[sale.condition as keyof typeof SALE_CONDITIONS],
      'vendu en l’état, sur offre.',
    ].filter(Boolean).join(' · '),
  }
}

export default async function FicheVehicule({ params }: { params: { ref: string } }) {
  const found = await load(params.ref)
  if (!found) notFound()
  const { sale, bids } = found

  const offers = publicBidSummary(sale.sale_mode as SaleMode, bids)
  const mini   = minimumBid(sale, offers.best)
  const ouvert = sale.status === 'published'
    && (!sale.closes_at || new Date(sale.closes_at) > new Date())

  const specs: [string, string][] = [
    ['Marque & modèle', [sale.brand, sale.model, sale.version].filter(Boolean).join(' ') || sale.title],
    ['Première immatriculation', sale.first_registration
      ? new Date(sale.first_registration).toLocaleDateString('fr-BE', { month: '2-digit', year: 'numeric' })
      : '—'],
    ['Kilométrage', sale.mileage != null
      ? `${sale.mileage.toLocaleString('fr-BE')} km${sale.mileage_source ? ` (${sale.mileage_source})` : ''}`
      : '—'],
    ['Carburant', sale.fuel || '—'],
    ['Boîte', sale.gearbox || '—'],
    ['Puissance', sale.power_kw ? `${sale.power_kw} kW` : '—'],
    ['Carrosserie', [sale.doors ? `${sale.doors} portes` : null, sale.color].filter(Boolean).join(' · ') || '—'],
    ['Clés', sale.keys_count != null ? String(sale.keys_count) : '—'],
    ['État', SALE_CONDITIONS[sale.condition as keyof typeof SALE_CONDITIONS] || sale.condition],
    ['Destination', SALE_DESTINATIONS[sale.destination as keyof typeof SALE_DESTINATIONS] || sale.destination],
    ['Contrôle technique', sale.ct_status === 'ok' ? 'En ordre'
      : sale.ct_status === 'a_refaire' ? 'À refaire'
      : sale.ct_status === 'non_fourni' ? 'Non fourni' : '—'],
    ['Car-Pass', sale.carpass === true ? 'Disponible' : sale.carpass === false ? 'Non disponible' : '—'],
    ['Où le voir', sale.visit_info || 'Pepinster, sur rendez-vous'],
  ]

  return (
    <section style={{ paddingTop: 34 }}>
      <div className="wrap" style={{ marginBottom: 22 }}>
        <Link className="card-link" href="/site/vente">← Tous les véhicules</Link>
      </div>

      <div className="wrap lot-detail">
        <div className="stack g32">
          <div className="stack g12">
            <span className="borne">
              Lot {sale.reference}
              {sale.closes_at && <> · clôture <Countdown iso={sale.closes_at} /></>}
            </span>
            <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.8rem)' }}>{sale.title}</h1>
            {sale.description && <p style={{ color: 'var(--ink-2)' }}>{sale.description}</p>}
          </div>

          <Gallery photos={sale.photos || []} alt={sale.title} />

          <div className="stack g16">
            <h3>Fiche technique</h3>
            <div className="spec">
              {specs.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
            </div>
          </div>

          {sale.damage && (
            <div className="stack g16">
              <h3>État &amp; dégâts constatés</h3>
              <p style={{ color: 'var(--ink-2)' }}>{sale.damage}</p>
              <div className="callout">
                <strong>Vendu en l’état.</strong> Ce descriptif est un constat visuel, pas une expertise.
                Nous vous encourageons à venir examiner le véhicule avant de faire une offre.
              </div>
            </div>
          )}

          {sale.destination === 'pieces' && (
            <div className="callout">
              <strong>Vendu pour pièces.</strong> Ce véhicule ne peut pas être réimmatriculé et doit suivre
              la filière prévue pour les véhicules hors d’usage.
            </div>
          )}
        </div>

        <div className="bidbox">
          {sale.sale_mode === 'fixed' ? (
            <>
              <div className="stack g8">
                <h3>Prix</h3>
                <p className="lead">Vendu en l’état, premier arrivé.</p>
              </div>
              <div className="bid-state">
                <div><small>Prix demandé</small><b>{sale.price ? eur(Number(sale.price)) : '—'}</b></div>
              </div>
            </>
          ) : (
            <>
              <div className="stack g8">
                <h3>Faire une offre</h3>
                <p className="lead">
                  {sale.sale_mode === 'auction'
                    ? 'Le meilleur montant est visible. Vous pouvez surenchérir jusqu’à la clôture.'
                    : 'Votre offre reste confidentielle. Vous recevrez un e-mail pour la confirmer.'}
                </p>
              </div>
              <div className="bid-state">
                <div>
                  <small>{sale.sale_mode === 'auction' ? 'Meilleure offre' : 'Offres reçues'}</small>
                  <b>{sale.sale_mode === 'auction'
                    ? (offers.best != null ? eur(offers.best) : '—')
                    : offers.count}</b>
                </div>
                {sale.closes_at && (
                  <div><small>Clôture dans</small><b><Countdown iso={sale.closes_at} /></b></div>
                )}
              </div>
            </>
          )}

          {ouvert ? (
            <BidForm
              reference={sale.reference}
              mode={sale.sale_mode as SaleMode}
              minimum={mini}
            />
          ) : (
            <div className="bid-ok" style={{ borderColor: 'var(--panel-line)' }}>
              <b>Ce véhicule n’accepte plus d’offres</b>
              <p>
                {sale.status === 'closed'
                  ? 'La vente est clôturée, nous dépouillons les offres reçues.'
                  : 'La date de clôture est passée.'}
              </p>
              <p>Toujours intéressé&nbsp;? Appelez le {TEL}, on vous dira ce qui reste disponible.</p>
            </div>
          )}

          <p style={{ fontSize: '.8rem', color: 'var(--panel-muted)' }}>
            Une question sur ce véhicule&nbsp;? <strong style={{ color: '#fff' }}>{TEL}</strong>
          </p>
        </div>
      </div>
    </section>
  )
}
