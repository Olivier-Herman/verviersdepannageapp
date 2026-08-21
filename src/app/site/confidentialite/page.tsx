// src/app/site/confidentialite/page.tsx
//
// Politique de confidentialité. Elle décrit ce que le site fait RÉELLEMENT :
//   · le formulaire d'offre écrit dans vehicle_sale_bids (Supabase, Irlande) ;
//   · l'assistant envoie la question à Anthropic (États-Unis) — c'est un
//     transfert hors UE, on le dit ;
//   · les e-mails de confirmation partent par Microsoft 365 ;
//   · aucun cookie de mesure d'audience ni de publicité n'est posé.
// Si l'un de ces points change dans le code, cette page doit changer avec.
// Olivier 2026-08-21.

import { TEL, TEL_HREF } from '../_data'

export const metadata = {
  title: 'Politique de confidentialité',
  description: 'Quelles données nous collectons sur ce site, pourquoi, combien de temps, et quels sont vos droits.',
  robots: { index: false },
}

export default function Confidentialite() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Vos données</span>
          <h1>Politique de confidentialité</h1>
          <p style={{ maxWidth: '62ch' }}>
            Ce que nous collectons sur ce site, pourquoi, combien de temps nous le gardons,
            et ce que vous pouvez exiger de nous.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap legal">
          <h2>Qui est responsable</h2>
          <p>
            <strong>Verviers Dépannage SA</strong>, Lefin 12, 4860 Pepinster, Belgique —
            BE 0460.759.205. Pour toute question relative à vos données&nbsp;:
            <a href="mailto:info@verviersdepannage.be"> info@verviersdepannage.be</a> ou
            le <a href={TEL_HREF}>{TEL}</a>.
          </p>

          <h2>Ce que nous collectons, et pourquoi</h2>
          <div className="tw" style={{ margin: '18px 0' }}>
            <table>
              <thead>
                <tr><th>Situation</th><th>Données</th><th>Pourquoi</th><th>Base légale</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Vous déposez une offre sur un véhicule</td>
                  <td>Nom, e-mail, téléphone, qualité (particulier ou professionnel), numéro de TVA
                      le cas échéant, montant proposé, destination du véhicule, message éventuel</td>
                  <td>Traiter votre offre, vous recontacter, attribuer le véhicule</td>
                  <td>Mesures précontractuelles à votre demande</td>
                </tr>
                <tr>
                  <td>Vous écrivez à l’assistant en ligne</td>
                  <td>Le contenu de vos messages</td>
                  <td>Produire une réponse</td>
                  <td>Notre intérêt légitime à vous renseigner</td>
                </tr>
                <tr>
                  <td>Vous consultez simplement le site</td>
                  <td>Adresse IP, type de navigateur, pages consultées (journaux techniques)</td>
                  <td>Sécurité, détection d’abus, bon fonctionnement</td>
                  <td>Notre intérêt légitime à protéger le service</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Nous ne vous demandons rien d’autre. Aucun profilage publicitaire, aucune revente de
            données, aucune inscription à une lettre d’information sans votre accord.
          </p>

          <h2>Cookies</h2>
          <p>
            Ce site ne dépose <strong>aucun cookie de mesure d’audience ni de publicité</strong>.
            Les polices de caractères sont servies depuis nos propres serveurs, sans appel à un
            tiers. Seuls des cookies strictement techniques peuvent être utilisés pour le
            fonctionnement du site.
          </p>

          <h2>Qui d’autre voit ces données</h2>
          <ul className="tight">
            <li>
              <strong>Supabase</strong> — hébergement de notre base de données, sur une
              infrastructure située dans l’Union européenne (Irlande).
            </li>
            <li>
              <strong>Vercel Inc.</strong> — hébergement du site et journaux techniques.
              Société de droit américain.
            </li>
            <li>
              <strong>Microsoft 365</strong> — envoi de nos e-mails, notamment celui qui vous
              demande de confirmer votre offre.
            </li>
            <li>
              <strong>Anthropic</strong> — les messages que vous adressez à l’assistant en ligne
              sont transmis à ce prestataire, établi aux États-Unis, pour générer la réponse.
              N’y écrivez pas d’information sensible&nbsp;: pour ça, le téléphone reste préférable.
            </li>
          </ul>
          <p>
            Les transferts hors de l’Union européenne s’appuient sur les garanties prévues par le
            règlement général sur la protection des données, notamment les clauses contractuelles
            types. Nous ne communiquons vos données à personne d’autre, sauf obligation légale ou
            réquisition d’une autorité.
          </p>

          <h2>Combien de temps nous les gardons</h2>
          <ul className="tight">
            <li>
              <strong>Offres non retenues</strong>&nbsp;: 12 mois après la clôture de la vente,
              le temps de traiter une contestation ou une remise en vente.
            </li>
            <li>
              <strong>Offre retenue</strong>&nbsp;: pendant la durée légale de conservation des
              pièces comptables liées à la vente.
            </li>
            <li>
              <strong>Échanges avec l’assistant</strong>&nbsp;: ils ne sont pas conservés par nous.
              Ils restent dans votre navigateur le temps de la visite et disparaissent quand vous
              fermez l’onglet.
            </li>
            <li>
              <strong>Journaux techniques</strong>&nbsp;: quelques semaines, le temps utile à la
              sécurité du service.
            </li>
          </ul>

          <h2>Vos droits</h2>
          <p>
            Vous pouvez à tout moment demander l’accès à vos données, leur rectification, leur
            effacement, la limitation de leur traitement, ou vous opposer à un traitement fondé
            sur notre intérêt légitime. Vous pouvez également demander à recevoir vos données
            dans un format lisible.
          </p>
          <p>
            Écrivez à <a href="mailto:info@verviersdepannage.be">info@verviersdepannage.be</a> ou
            appelez le <a href={TEL_HREF}>{TEL}</a>. Nous répondons dans le mois. Une pièce
            d’identité peut vous être demandée si nous avons un doute sur qui nous écrit.
          </p>
          <p>
            Si notre réponse ne vous satisfait pas, vous pouvez saisir l’Autorité de protection
            des données&nbsp;: rue de la Presse 35, 1000 Bruxelles —
            <a href="https://www.autoriteprotectiondonnees.be" rel="noopener noreferrer" target="_blank"> autoriteprotectiondonnees.be</a>.
          </p>

          <h2>Une précision sur les véhicules en fourrière</h2>
          <p>
            Nous ne confirmons jamais par ce site, ni par l’assistant, la présence d’un véhicule
            déterminé dans notre parc. Cette information appartient à la zone de police qui a
            ordonné l’enlèvement&nbsp;: c’est à elle de renseigner le propriétaire.
          </p>

          <h2>Modifications</h2>
          <p>
            Cette politique peut évoluer si nos outils changent. La date ci-dessous indique la
            dernière version en vigueur.
          </p>

          <p className="maj">Dernière mise à jour&nbsp;: 21 août 2026.</p>
        </div>
      </section>
    </>
  )
}
