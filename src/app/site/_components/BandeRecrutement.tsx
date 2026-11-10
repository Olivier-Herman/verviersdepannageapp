'use client'

// Bande « Venez rouler avec nous » de l'accueil : seulement quand on recrute
// (réglage `site_recrutement_actif`). La page /emploi reste joignable.

import Link from 'next/link'
import { useEtatSite } from './EtatSite'
import { p } from '../_data'

export default function BandeRecrutement() {
  const { recrute } = useEtatSite()
  if (!recrute) return null
  return (
    <section className="dark">
      <div className="wrap recrute">
        <div className="stack g12">
          <span className="borne on-dark">Emploi</span>
          <h2>Chauffeur-dépanneur&nbsp;? <em>Venez rouler avec nous.</em></h2>
          <p>Deux minutes depuis votre téléphone, sans CV à préparer. Nous vous rappelons.</p>
        </div>
        <Link className="big-tel" href={p('/emploi')}>Je postule →</Link>
      </div>
    </section>
  )
}
