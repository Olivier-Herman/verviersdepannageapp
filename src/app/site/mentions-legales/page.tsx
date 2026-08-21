// src/app/site/mentions-legales/page.tsx
//
// Mentions légales. Tout ce qui figure ici est vérifié : dénomination, forme
// juridique, adresse et numéro d'entreprise viennent des documents déjà émis
// par VD Soft (factures, reçus). Rien n'est inventé — les deux points que nous
// ne pouvons pas certifier (adresses postales des hébergeurs) sont formulés
// sans adresse plutôt qu'avec une adresse approximative. Olivier 2026-08-21.

import { TEL, TEL_HREF } from '../_data'

export const metadata = {
  title: 'Mentions légales',
  description: 'Éditeur, hébergement, propriété intellectuelle et responsabilité du site verviersdepannage.be.',
  robots: { index: false },
}

export default function MentionsLegales() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Informations légales</span>
          <h1>Mentions légales</h1>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap legal">
          <h2>Éditeur du site</h2>
          <p>
            <strong>Verviers Dépannage SA</strong><br />
            Lefin 12, 4860 Pepinster, Belgique<br />
            Numéro d’entreprise et de TVA&nbsp;: BE 0460.759.205<br />
            Registre des personnes morales de Liège, division Verviers<br />
            Téléphone&nbsp;: <a href={TEL_HREF}>{TEL}</a><br />
            E-mail&nbsp;: <a href="mailto:info@verviersdepannage.be">info@verviersdepannage.be</a>
          </p>
          <p>
            Responsable de la publication&nbsp;: la direction de Verviers Dépannage SA.
          </p>

          <h2>Hébergement</h2>
          <p>
            Le site est hébergé par <strong>Vercel Inc.</strong>, société de droit américain
            (<a href="https://vercel.com" rel="noopener noreferrer" target="_blank">vercel.com</a>).
          </p>
          <p>
            Les données du site (notamment les véhicules mis en vente et les offres reçues) sont
            conservées chez <strong>Supabase</strong>, sur une infrastructure située dans l’Union
            européenne (Irlande).
          </p>

          <h2>Objet du site</h2>
          <p>
            Le site présente les activités de Verviers Dépannage SA&nbsp;: dépannage et remorquage,
            fourrière pour les zones de police, interventions sur circuit et lors d’événements,
            services aux professionnels et vente de véhicules.
          </p>
          <p>
            Les informations publiées le sont à titre indicatif. Elles ne constituent ni une offre
            contractuelle, ni un engagement sur un délai d’intervention. Seul un accord conclu par
            téléphone ou par écrit avec nos services engage l’entreprise.
          </p>

          <h2>Chiffres publiés</h2>
          <p>
            Les statistiques affichées (nombre d’interventions, communes desservies, délais)
            sont extraites de notre système de dispatch pour la période indiquée à côté de chaque
            chiffre. Ce sont des mesures passées, pas une promesse de résultat.
          </p>

          <h2>Frais de fourrière</h2>
          <p>
            Les montants d’enlèvement et de gardiennage affichés relèvent du tarif des frais de
            justice. Ils ne sont pas fixés par Verviers Dépannage SA et sont susceptibles d’évoluer
            en même temps que la réglementation applicable.
          </p>

          <h2>Vente de véhicules</h2>
          <p>
            Les véhicules proposés sont vendus en l’état, sans garantie de fonctionnement. Les
            conditions applicables figurent sur la page consacrée aux véhicules à vendre. Le dépôt
            d’une offre engage son auteur&nbsp;; Verviers Dépannage SA reste libre de ne pas attribuer
            un véhicule.
          </p>

          <h2>Propriété intellectuelle</h2>
          <p>
            L’ensemble des éléments du site — textes, photographies, logo, mise en page — est
            protégé. Toute reproduction ou représentation, totale ou partielle, sans autorisation
            écrite préalable est interdite. Le logo et la dénomination «&nbsp;Verviers Dépannage&nbsp;»
            sont la propriété de Verviers Dépannage SA.
          </p>

          <h2>Responsabilité</h2>
          <p>
            Nous mettons tout en œuvre pour que les informations publiées soient exactes et à jour,
            sans pouvoir le garantir. Verviers Dépannage SA ne peut être tenue responsable d’une
            erreur, d’une omission, ni d’une indisponibilité temporaire du site.
          </p>
          <p>
            Le site peut renvoyer vers des sites tiers dont nous ne maîtrisons ni le contenu ni les
            pratiques. Ces liens n’emportent aucune approbation de notre part.
          </p>

          <h2>Assistant en ligne</h2>
          <p>
            Le site propose un assistant automatisé. Ses réponses sont générées par un système
            d’intelligence artificielle à partir des informations publiées ici. Elles peuvent être
            incomplètes ou inexactes et n’engagent pas l’entreprise. Pour toute demande qui compte,
            appelez le <a href={TEL_HREF}>{TEL}</a>.
          </p>

          <h2>Droit applicable</h2>
          <p>
            Le présent site et son utilisation sont régis par le droit belge. Tout litige relève de
            la compétence des tribunaux de l’arrondissement judiciaire de Liège, division Verviers.
          </p>

          <p className="maj">Dernière mise à jour&nbsp;: 21 août 2026.</p>
        </div>
      </section>
    </>
  )
}
