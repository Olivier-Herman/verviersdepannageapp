import { Suspense } from 'react'
import { TEL, TEL_HREF, DEPOTS } from '../_data'
import ContactForm from '../_components/ContactForm'

export const metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact & dépôts',
  description:
    'Un seul numéro 24h/24 : 087 35 18 20. Dépôts de Pepinster, Verviers et Aywaille. '
  + 'Fourrière du lundi au vendredi de 9h à 17h.',
}

export default function Contact() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g22">
          <span className="borne on-dark">Contact</span>
          <h1>Un numéro, jour et nuit.</h1>
          <div><a className="big-tel" href={TEL_HREF}>☎ <span className="num">{TEL}</span></a></div>
          <p>
            Urgences 24h/24, 7j/7. Pour l’administratif et la fourrière, appelez pendant les heures de bureau.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="depots">
            {DEPOTS.map(d => (
              <div className="depot" key={d.nom}>
                <span className="tag">{d.tag}</span>
                <h3>{d.nom}</h3>
                <address>{d.adresse.map((l, i) => <span key={i}>{l}<br /></span>)}</address>
                <p style={{ fontSize: '.9rem', color: 'var(--muted)' }}>
                  {d.nom === 'Pepinster'
                    ? 'Fourrière : lundi au vendredi, 9h – 17h. Fermée week-ends et jours fériés.'
                    : d.note}
                </p>
              </div>
            ))}
          </div>
          <div className="lot-detail" id="ecrire">
            <div className="stack g16">
              <div className="sec-head" style={{ marginBottom: 0 }}>
                <span className="borne">Nous écrire</span>
                <h2>Pour tout ce qui n’est pas urgent</h2>
                <p>
                  Un rendez-vous, un devis, un transport à planifier, une couverture d’événement.
                  On répond pendant les heures de bureau, en général le jour même.
                </p>
              </div>
              <div className="ph" style={{ aspectRatio: '16 / 9', borderRadius: 16 }}>
                <span className="ph-label">Carte — les 3 dépôts, plans d’accès, itinéraire en un clic</span>
              </div>
            </div>
            <div className="bidbox" style={{ position: 'static' }}>
              <Suspense fallback={null}><ContactForm /></Suspense>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
