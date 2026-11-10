import CandidatureForm from '../_components/CandidatureForm'

export const metadata = {
  alternates: { canonical: '/emploi' },
  title: 'Chauffeur-dépanneur : on recrute',
  description:
    'Chauffeur-dépanneur à Pepinster, Verviers, Spa et environs. Permis B, C ou CE. '
  + 'Candidature en deux minutes depuis votre téléphone, sans CV à préparer.',
}

export default function Emploi() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Emploi</span>
          <h1>Chauffeur-dépanneur&nbsp;?<br /><em>Venez rouler avec nous.</em></h1>
          <p style={{ maxWidth: '60ch' }}>
            Pannes, accidents, fourrière, circuit de Spa-Francorchamps&nbsp;: pas deux journées pareilles.
            Laissez-nous vos coordonnées en deux minutes, nous vous rappelons pour faire connaissance.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />
      <section>
        <div className="wrap emploi">
          <div className="stack g16">
            <h2>Ce qu’on cherche</h2>
            <ul className="tight">
              <li>Un permis B au minimum&nbsp;; C ou CE pour les poids lourds.</li>
              <li>Pas besoin d’avoir déjà fait du dépannage&nbsp;: on forme sur le terrain.</li>
              <li>De la disponibilité pour les gardes de nuit et de week-end, à tour de rôle.</li>
              <li>Le sens du contact&nbsp;: la personne en panne a souvent passé une mauvaise journée.</li>
            </ul>
          </div>
          <div className="bidbox"><CandidatureForm /></div>
        </div>
      </section>
    </>
  )
}
