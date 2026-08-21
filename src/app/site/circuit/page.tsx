import { TEL, TEL_HREF } from '../_data'

export const metadata = {
  title: 'Circuit & grands événements',
  description:
    'Spa-Francorchamps, Francofolies, grandes manifestations : dépannage de véhicules de sport et de '
  + 'collection, transferts paddock, couverture d’événement. Point d’appui à Francorchamps.',
}

export default function Circuit() {
  return (
    <>
      <div className="kerb" aria-hidden="true" />
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Circuit &amp; grands événements</span>
          <h1>Spa-Francorchamps,<br />Francofolies, et tout ce<br />qui rassemble une foule.</h1>
          <p style={{ maxWidth: '62ch' }}>
            Quand des dizaines de milliers de personnes arrivent au même endroit en même temps, il y a des
            véhicules mal garés, des accès de secours bloqués et des voitures qui refusent de redémarrer au
            moment de repartir. C’est notre terrain depuis longtemps.
          </p>
        </div>
      </section>
      <div className="kerb" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="cards">
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — plateau bâché,<br />voiture de sport</span></div>
              <div className="card-body">
                <h3>Véhicules de sport &amp; de collection</h3>
                <p>
                  Garde au sol réduite, points de levage spécifiques, carrosseries qu’on ne sangle pas
                  n’importe où. Plateau bâché, treuil à sangle douce, rampes longues. On sait ce qu’on
                  touche, et ce que ça vaut.
                </p>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — dépanneuse<br />dans le paddock</span></div>
              <div className="card-body">
                <h3>Roulages &amp; journées d’essais</h3>
                <p>
                  Récupération en bord de piste, transfert vers le box, du box vers le camion, du circuit
                  vers l’atelier. Nous disposons d’un point d’appui à Francorchamps, à quelques minutes
                  des entrées.
                </p>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — festival,<br />parking et dépanneuse</span></div>
              <div className="card-body">
                <h3>Couverture d’événement</h3>
                <p>
                  Dépanneuses en pré-positionnement, dégagement des accès de secours, enlèvement des
                  véhicules bloquants, parc de regroupement et restitution aux propriétaires. En lien avec
                  l’organisateur et la zone de police.
                </p>
              </div>
            </div>
          </div>

          <div className="stats">
            <div className="stat"><b>143</b><span>interventions coordonnées sur les Francofolies</span><i>édition 2026</i></div>
            <div className="stat"><b>71</b><span>interventions à Francorchamps</span><i>01/06 → 20/08/2026</i></div>
            <div className="stat"><b>95</b><span>interventions à Stavelot</span><i>même période</i></div>
            <div className="stat"><b>260</b><span>interventions à Spa</span><i>même période</i></div>
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Organisateurs</span>
              <h2>Préparer une couverture</h2>
              <p>
                Manifestation sportive, festival, brocante, marché de Noël, chantier avec voirie fermée&nbsp;:
                on cadre ensemble le nombre de camions, les créneaux, les points de pré-positionnement et le
                parc de regroupement. Devis avant l’événement, rapport après.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <a className="big-tel" href={TEL_HREF} style={{ fontSize: '1.2rem' }}>
                ☎ <span className="num">{TEL}</span>
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
