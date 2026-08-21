// src/app/site/vente/page.tsx
//
// La liste vient de la base, pas d'une maquette : mêmes colonnes publiques que
// /api/ventes (PUBLIC_COLUMNS), donc rien de l'origine du véhicule ne peut
// fuir ici par distraction. Rendu à la demande, jamais mis en cache : un lot
// clôturé ne doit pas rester affiché comme ouvert. Olivier 2026-08-21.

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase'
import {
  PUBLIC_COLUMNS, publicBidSummary, SALE_CONDITIONS,
  type SaleMode, type BidStatus,
} from '@/lib/ventes/types'
import Countdown from '../_components/Countdown'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Véhicules à vendre',
  description:
    'Voitures et utilitaires à vendre en l’état, au plus offrant ou à prix fixe. Photos, kilométrage, '
  + 'état : déposez votre offre en ligne. Visibles sur rendez-vous à Pepinster.',
}

const eur = (n: number) => n.toLocaleString('fr-BE') + ' €'

export default async function VenteListe() {
  const sb = createAdminClient()
  const { data: sales } = await sb.from('vehicle_sales')
    .select(PUBLIC_COLUMNS)
    .in('status', ['published'])
    .order('closes_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  const lots = (sales || []) as any[]
  const ids  = lots.map(l => l.id)
  const byId: Record<string, { amount: number; status: BidStatus }[]> = {}
  if (ids.length) {
    const { data: bids } = await sb.from('vehicle_sale_bids')
      .select('sale_id, amount, status').in('sale_id', ids)
    for (const b of bids || []) (byId[b.sale_id] ||= []).push({ amount: Number(b.amount), status: b.status })
  }

  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Véhicules à vendre</span>
          <h1>Des véhicules à vendre.<br />À vous de faire<br />votre offre.</h1>
          <p style={{ maxWidth: '62ch' }}>
            Nous mettons régulièrement des véhicules en vente, en l’état&nbsp;: voitures et utilitaires,
            roulants ou pour pièces. Vous déposez votre offre en ligne, nous attribuons le véhicule à la
            meilleure offre à la clôture.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">En cours</span>
            <h2>
              {lots.length === 0 ? 'Rien en ligne pour le moment'
                : lots.length === 1 ? 'Un véhicule ouvert aux offres'
                : `${lots.length} véhicules ouverts aux offres`}
            </h2>
            <p>
              Visibles sur rendez-vous à Pepinster. Vendus en l’état, sans garantie. Les offres sont
              confidentielles&nbsp;: nous affichons le nombre d’offres reçues, jamais les montants.
            </p>
          </div>

          {lots.length === 0 ? (
            <div className="empty">
              Aucun véhicule en vente en ce moment. Repassez dans quelques jours,
              ou appelez-nous pour nous dire ce que vous cherchez.
            </div>
          ) : (
            <div className="lots">
              {lots.map(l => {
                const offers = publicBidSummary(l.sale_mode as SaleMode, byId[l.id] || [])
                const annee  = l.first_registration ? new Date(l.first_registration).getFullYear() : null
                return (
                  <Link className="lot" key={l.id} href={`/site/vente/${l.reference}`}>
                    <div className="lot-ph">
                      <span className={`badge ${l.condition}`}>
                        {SALE_CONDITIONS[l.condition as keyof typeof SALE_CONDITIONS] || l.condition}
                      </span>
                      {l.photos?.[0]
                        /* eslint-disable-next-line @next/next/no-img-element */
                        ? <img src={l.photos[0]} alt={l.title} loading="lazy" />
                        : <span className="ph-label" style={{ margin: 'auto' }}>Photo à venir</span>}
                    </div>
                    <div className="lot-body">
                      <h3>{l.title}</h3>
                      <div className="lot-specs">
                        {annee && <span>{annee}</span>}
                        {l.mileage != null && <span>{l.mileage.toLocaleString('fr-BE')} km</span>}
                        {l.fuel && <span>{l.fuel}</span>}
                        {l.gearbox && <span>{l.gearbox}</span>}
                      </div>
                      {l.damage && <p style={{ fontSize: '.9rem', color: 'var(--ink-2)' }}>{l.damage}</p>}
                      <div className="lot-foot">
                        {l.sale_mode === 'fixed' ? (
                          <span><small>Prix</small><b>{l.price ? eur(Number(l.price)) : '—'}</b></span>
                        ) : (
                          <span><small>Clôture dans</small><b><Countdown iso={l.closes_at} /></b></span>
                        )}
                        <span style={{ textAlign: 'right' }}>
                          <small>{l.sale_mode === 'auction' ? 'Meilleure offre' : 'Offres'}</small>
                          <b>{l.sale_mode === 'auction' && offers.best != null ? eur(offers.best) : offers.count}</b>
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="alt">
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Comment ça marche</span>
            <h2>Quatre étapes, pas de surprise</h2>
          </div>
          <div className="steps four">
            <div className="step"><span className="km">01</span><h4>Vous regardez</h4>
              <p>Photos, kilométrage, état, dégâts connus. Et vous pouvez venir voir le véhicule sur place, sur rendez-vous.</p></div>
            <div className="step"><span className="km">02</span><h4>Vous déposez une offre</h4>
              <p>Un montant, vos coordonnées, et ce que vous comptez faire du véhicule. Vous recevez un e-mail de confirmation à valider.</p></div>
            <div className="step"><span className="km">03</span><h4>On clôture</h4>
              <p>À la date annoncée. Nous retenons la meilleure offre et prévenons tout le monde, retenus comme non retenus.</p></div>
            <div className="step"><span className="km">04</span><h4>Vous enlevez</h4>
              <p>Paiement, facture, documents du véhicule, puis enlèvement sous sept jours. Au-delà, des frais de stationnement s’appliquent.</p></div>
          </div>

          <div className="stack g16">
            <h3>Conditions de vente</h3>
            <ul className="rules tight">
              <li>Les véhicules sont vendus <strong>en l’état, sans garantie</strong>. L’état décrit est celui que nous constatons, pas un rapport d’expertise.</li>
              <li>Nous ne sommes pas tenus d’attribuer le véhicule&nbsp;: si aucune offre n’atteint notre prix minimum, la vente est annulée.</li>
              <li>Une offre déposée engage son auteur. Elle est confidentielle et n’est pas publiée.</li>
              <li>Le prix s’entend TVA comprise. Facture remise à l’enlèvement.</li>
              <li>Pour un véhicule <strong>destiné à reprendre la route</strong>&nbsp;: contrôle technique de vente et Car-Pass fournis conformément à la réglementation belge.</li>
              <li>Pour un véhicule <strong>vendu pour pièces ou hors d’usage</strong>&nbsp;: il ne peut pas être réimmatriculé et doit suivre la filière prévue.</li>
              <li>Enlèvement sous sept jours après paiement, depuis nos dépôts. Nous n’assurons pas la livraison.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}
