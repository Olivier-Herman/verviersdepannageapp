// src/app/site/tarifs/page.tsx
//
// Les deux grilles réglementées, en clair. Aucune n'est fixée par Verviers
// Dépannage : la première vient de la circulaire 131/13 du 16 janvier 2026
// (frais de justice en matière pénale), la seconde du régime SIABIS+ sur le
// réseau structurant wallon.
//
// Pourquoi une page et pas seulement le PDF : un automobiliste qui conteste un
// montant lit son téléphone, pas un PDF de deux pages. Le PDF reste en
// téléchargement, c'est lui qu'on sort au comptoir. Olivier 2026-08-21.

import Link from 'next/link'
import { TEL, TEL_HREF, TARIF_MAL_GAREE } from '../_data'

export const metadata = {
  title: 'Tarifs officiels — saisies judiciaires et SIABIS+',
  description:
    'Les grilles réglementées appliquées aux enlèvements judiciaires (circulaire 131/13) et aux '
  + 'interventions SIABIS+ sur le réseau structurant wallon. Montants TVAC et HTVA.',
}

type Ligne = { poste: string; detail?: string; a: string; aH: string; b?: string; bH?: string }

const ENLEVEMENT: Ligne[] = [
  { poste: 'Tarif I — véhicules < 3,5 T', detail: 'voitures, mono-volumes, camionnettes, remorques',
    a: '113,81 €', aH: '94,06 €',  b: '170,74 €', bH: '141,11 €' },
  { poste: 'Tarif II — de 3,5 T à moins de 7,5 T',
    a: '219,09 €', aH: '181,07 €', b: '341,44 €', bH: '282,18 €' },
  { poste: 'Tarif III — de 7,5 T à moins de 19 T',
    a: '341,44 €', aH: '282,18 €', b: '512,12 €', bH: '423,24 €' },
  { poste: 'Tarif IV — 19 T et plus',
    a: '455,21 €', aH: '376,21 €', b: '682,83 €', bH: '564,32 €' },
  { poste: 'Kilomètre au-delà des 15 premiers', detail: 'véhicules < 3,5 T',
    a: '1,9018 €', aH: '1,5717 €', b: '2,8979 €', bH: '2,3950 €' },
  { poste: 'Kilomètre au-delà des 15 premiers', detail: 'véhicules ≥ 3,5 T',
    a: '3,3404 €', aH: '2,7607 €', b: '4,9808 €', bH: '4,1164 €' },
]

const GARDIENNAGE: Ligne[] = [
  { poste: 'Emplacement inférieur à une voiture', detail: 'cyclomoteurs, motos',
    a: '1,89 €', aH: '1,56 €', b: '0,97 €', bH: '0,80 €' },
  { poste: 'Emplacement équivalent à une voiture', detail: 'voitures, mono-volumes, camionnettes, remorques',
    a: '3,80 €', aH: '3,14 €', b: '1,89 €', bH: '1,56 €' },
  { poste: 'Emplacement supérieur à une voiture',
    a: '5,70 €', aH: '4,71 €', b: '2,83 €', bH: '2,34 €' },
  { poste: 'De 3,5 T à moins de 7,5 T',
    a: '6,72 €', aH: '5,55 €', b: '3,71 €', bH: '3,07 €' },
  { poste: 'De 7,5 T à moins de 19 T', detail: 'au cas par cas, selon l’encombrement',
    a: '7,62 à 15,17 €', aH: '6,30 à 12,54 €', b: '4,22 à 7,62 €', bH: '3,49 à 6,30 €' },
]

const SIABIS: Ligne[] = [
  { poste: 'Type 1A — dépannage', detail: 'véhicule en panne ou accidenté', a: '196,00 €', aH: '162,00 €', b: '294,00 €', bH: '243,00 €' },
  { poste: 'Type 1B — véhicule abandonné', a: '196,00 €', aH: '162,00 €', b: '294,00 €', bH: '243,00 €' },
  { poste: 'Type 1C — dépôt communal',     a: '196,00 €', aH: '162,00 €', b: '294,00 €', bH: '243,00 €' },
  { poste: 'Type 1D — loze rit',           a: '196,00 €', aH: '162,00 €', b: '294,00 €', bH: '243,00 €' },
  { poste: 'Type 2 — balisage', detail: 'sécurisation de la zone d’intervention', a: '181,50 €', aH: '150,00 €', b: '212,00 €', bH: '175,00 €' },
  { poste: 'Type 3 — encombrant', detail: 'perte de chargement, objet sur la voirie', a: '181,50 €', aH: '150,00 €', b: '212,00 €', bH: '175,00 €' },
  { poste: 'Type 4 — remorque ou caravane < 750 kg', a: '130,00 €', aH: '107,00 €', b: '195,00 €', bH: '161,00 €' },
  { poste: 'Type 5 — remorque ou caravane > 750 kg', a: '130,00 €', aH: '107,00 €', b: '195,00 €', bH: '161,00 €' },
]

const SIABIS_PLUS: Ligne[] = [
  { poste: 'Supplément horaire', detail: 'par tranche de 15 minutes entamée', a: '26,00 €', aH: '21,00 €', b: '39,00 €', bH: '32,00 €' },
  { poste: 'Frais d’évacuation par taxi', a: '65,00 €', aH: '54,00 €', b: '65,00 €', bH: '54,00 €' },
  { poste: 'Supplément kilométrique', detail: 'aller-retour, par kilomètre', a: '1,30 €', aH: '1,10 €', b: '2,00 €', bH: '1,65 €' },
  { poste: 'Gardiennage', detail: 'par jour entamé, tarif unique', a: '20,00 €', aH: '16,50 €' },
]

const SIABIS_TECH: Ligne[] = [
  { poste: 'Absence d’anneau de remorquage *', a: '20,00 €', aH: '16,50 €' },
  { poste: 'Roue de secours *',                a: '30,00 €', aH: '25,00 €' },
  { poste: 'Déconnexion de la batterie',       a: '20,00 €', aH: '16,50 €' },
  { poste: 'Usage de la grue *',               a: '90,00 €', aH: '74,00 €' },
  { poste: 'Absence de clés *',                a: '30,00 €', aH: '25,00 €' },
  { poste: 'Absorbant', detail: 'par sac utilisé', a: '25,00 €', aH: '21,00 €' },
  { poste: 'Usage d’un véhicule adapté',       a: '24,00 €', aH: '20,00 €', b: '36,00 €', bH: '30,00 €' },
]

function Grille({ lignes, colA, colB }: { lignes: Ligne[]; colA: string; colB?: string }) {
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th>Prestation</th>
            <th>{colA}</th>
            {colB && <th>{colB}</th>}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={l.poste + i}>
              <td>
                {l.poste}
                {l.detail && <><br /><span style={{ color: 'var(--muted)', fontSize: '.85em' }}>{l.detail}</span></>}
              </td>
              <td className="num">
                <strong>{l.a}</strong><br />
                <span style={{ color: 'var(--muted)', fontSize: '.85em' }}>{l.aH} HTVA</span>
              </td>
              {colB && (
                <td className="num">
                  {l.b
                    ? <><strong>{l.b}</strong><br /><span style={{ color: 'var(--muted)', fontSize: '.85em' }}>{l.bH} HTVA</span></>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Tarifs() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Tarifs officiels</span>
          <h1>Ce que nous facturons,<br />et qui le décide.</h1>
          <p style={{ maxWidth: '62ch' }}>
            Deux grilles s’appliquent selon la raison de l’intervention. Aucune des deux n’est fixée
            par Verviers Dépannage&nbsp;: elles sont réglementées, publiques, et identiques pour tous
            les dépanneurs qui travaillent sous ces régimes.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Saisies &amp; enlèvements judiciaires</span>
            <h2>Circulaire 131/13 du 16 janvier 2026</h2>
            <p>
              Prix forfaitaires maximum applicables aux saisies pour défaut d’assurance et aux
              enlèvements ordonnés sur réquisition judiciaire. Le tarif applicable dépend de l’heure
              et du jour de l’intervention.
            </p>
          </div>

          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            <div className="card"><div className="card-body">
              <h3>Tarif de jour</h3>
              <p>Du lundi au vendredi, de 8h à 20h, hors jours fériés.</p>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>Tarif de nuit et week-end</h3>
              <p>De 20h à 8h, ainsi que les samedis, dimanches et jours fériés. Soit <strong>+50&nbsp;%</strong> sur l’enlèvement.</p>
            </div></div>
          </div>

          <div className="stack g12">
            <h3>Enlèvement du véhicule</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: '.95rem' }}>
              Forfait comprenant le déplacement de 1 à 15 km ainsi que le jour du remorquage.
            </p>
            <Grille lignes={ENLEVEMENT} colA="Jour" colB="Nuit / week-end" />
          </div>

          <div className="stack g12">
            <h3>Gardiennage</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: '.95rem' }}>
              Compté par jour, du lendemain du dépôt jusqu’au jour du départ du véhicule.
              Notre parc est un <strong>emplacement extérieur</strong>&nbsp;: pour une voiture,
              c’est donc 1,89 € TVAC par jour.
            </p>
            <Grille lignes={GARDIENNAGE} colA="Intérieur ou couvert" colB="Extérieur" />
          </div>

          <div className="stack g12">
            <h3>Frais administratifs</h3>
            <div className="tw">
              <table>
                <thead><tr><th>Prestation</th><th>Montant</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Restitution d’un véhicule saisi pour défaut d’assurance<br />
                      <span style={{ color: 'var(--muted)', fontSize: '.85em' }}>
                        frais de dossier couvrant la remise du véhicule à son propriétaire
                      </span>
                    </td>
                    <td className="num"><strong>45,58 €</strong><br />
                      <span style={{ color: 'var(--muted)', fontSize: '.85em' }}>37,67 € HTVA</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="callout">
            <strong>Une fois la saisie levée, le compteur change.</strong> Le tarif ci-dessus ne
            s’applique que tant que la saisie court. Si le véhicule reste chez nous après la levée,
            il occupe une place à nos conditions&nbsp;: 20 € HTVA par jour. Voir la
            page <Link href="/site/fourriere">Fourrière</Link>.
          </div>

          <p>
            <a className="tel-btn" href="/docs/tarifs-saisies-judiciaires-2026.pdf" target="_blank" rel="noopener">
              Télécharger la grille (PDF)
            </a>
          </p>
        </div>
      </section>

      <section className="alt">
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Réseau structurant wallon</span>
            <h2>Tarifs SIABIS+</h2>
            <p>
              Ces montants s’appliquent aux dépannages et évacuations sur le réseau structurant
              wallon, dans le cadre du dispositif SIABIS+ (SPW Mobilité &amp; Infrastructures,
              SOFICO, Police fédérale). Le tarif applicable est déterminé par l’heure de début
              de l’intervention.
            </p>
          </div>

          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            <div className="card"><div className="card-body">
              <h3>Tarif standard</h3>
              <p>Du lundi au vendredi, de 7h à 19h.</p>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>Tarif majoré</h3>
              <p>Du lundi au vendredi de 19h à 7h, ainsi que les samedis, dimanches et jours fériés.</p>
            </div></div>
          </div>

          <div className="stack g12">
            <h3>Prestations de dépannage</h3>
            <Grille lignes={SIABIS} colA="Standard" colB="Majoré" />
          </div>

          <div className="stack g12">
            <h3>Frais complémentaires</h3>
            <Grille lignes={SIABIS_PLUS} colA="Standard" colB="Majoré" />
          </div>

          <div className="stack g12">
            <h3>Suppléments techniques</h3>
            <Grille lignes={SIABIS_TECH} colA="Standard" colB="Majoré" />
            <p style={{ fontSize: '.88rem', color: 'var(--muted)' }}>
              * Ces suppléments ne sont pas cumulatifs entre eux.
            </p>
          </div>

          <p>
            <a className="tel-btn" href="/docs/tarifs-siabis-2026.pdf" target="_blank" rel="noopener">
              Télécharger la grille (PDF)
            </a>
          </p>
        </div>
      </section>

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Stationnement gênant</span>
            <h2>Mal garée</h2>
            <p>
              Un véhicule enlevé parce qu’il gênait ne relève d’aucune des deux grilles ci-dessus&nbsp;:
              ce n’est pas une saisie et ce n’est pas une intervention sur le réseau structurant.
            </p>
          </div>
          <div className="tw">
            <table>
              <thead><tr><th>Poste</th><th>Base</th><th>Montant HTVA</th><th>Montant TVAC</th></tr></thead>
              <tbody>
                {TARIF_MAL_GAREE.map(l => (
                  <tr key={l.poste}>
                    <td>{l.poste}</td><td>{l.base}</td>
                    <td className="num">{l.htva}</td><td className="num">{l.tvac}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout">
            <strong>Un doute sur un montant&nbsp;?</strong> Appelez le <a href={TEL_HREF}>{TEL}</a>.
            On vous détaille la facture poste par poste, et on vous dit de quelle grille il relève.
          </div>

          <p style={{ fontSize: '.88rem', color: 'var(--muted)' }}>
            Les grilles réglementées sont indexées et peuvent évoluer. Les montants publiés ici sont
            ceux en vigueur au 21 août 2026. En cas de divergence, le texte officiel prévaut.
          </p>
        </div>
      </section>
    </>
  )
}
