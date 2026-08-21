import { TEL, TEL_HREF } from '../_data'

export const metadata = {
  title: 'Dépannage & remorquage 24h/24',
  description:
    'Panne, accident, crevaison, batterie : intervention sur place ou remorquage vers le garage de votre '
  + 'choix, 24h/24 dans la région verviétoise. 087 35 18 20.',
}

export default function Depannage() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Dépannage &amp; remorquage · 24h/24</span>
          <h1>Mettez-vous en sécurité.<br />Puis appelez-nous.</h1>
          <p style={{ maxWidth: '60ch' }}>
            Un véhicule qui ne démarre plus, un pneu éclaté sur la E42, un accrochage au rond-point.
            On vous dit tout de suite si ça se règle sur place ou s’il faut remorquer, et combien
            de temps il nous faut pour arriver.
          </p>
          <div style={{ marginTop: 8 }}>
            <a className="big-tel" href={TEL_HREF}>☎ <span className="num">{TEL}</span></a>
          </div>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="cards">
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — intervention<br />au bord de la route</span></div>
              <div className="card-body">
                <h3>Réparé sur place</h3>
                <p>
                  Batterie à plat, roue crevée, plus de carburant, clés enfermées, courroie. Sur les trois
                  derniers mois, <strong>948 interventions se sont terminées sans remorquage</strong>. Quand
                  c’est réparable au bord de la route, on le fait au bord de la route.
                </p>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — véhicule<br />chargé sur plateau</span></div>
              <div className="card-body">
                <h3>Remorquage</h3>
                <p>
                  Le véhicule part vers le garage de votre choix, votre domicile, ou l’un de nos dépôts en
                  attendant que vous décidiez. <strong>Vous</strong> choisissez la destination — pas nous,
                  et pas votre assistance à votre place.
                </p>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — poids lourd<br />ou utilitaire</span></div>
              <div className="card-body">
                <h3>Tous gabarits</h3>
                <p>
                  Voitures, utilitaires, camping-cars, véhicules électriques, poids lourds.
                  <strong> 14 camions</strong>, du plateau léger au porte-engins. Le bon outil part
                  dès le premier appel.
                </p>
              </div>
            </div>
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Après l’intervention</span>
              <h2>Et si vous ne voulez pas récupérer le véhicule&nbsp;?</h2>
            </div>
            <div className="proc">
              <div className="proc-item">
                <span className="proc-n">→</span>
                <div className="proc-b">
                  <h4>Véhicule chez nous après une panne, un accident ou un enlèvement pour stationnement gênant</h4>
                  <p>
                    Vous pouvez y renoncer directement avec nous. Un document est établi et signé sur place,
                    avec votre carte d’identité, et les frais de stationnement s’arrêtent à ce moment-là.
                    Ça évite qu’une note continue de courir sur un véhicule dont vous ne voulez plus.
                  </p>
                </div>
              </div>
              <div className="proc-item">
                <span className="proc-n">→</span>
                <div className="proc-b">
                  <h4>Véhicule saisi par la police</h4>
                  <p>
                    Là, ce n’est pas nous qui pouvons l’enregistrer&nbsp;: la démarche se fait
                    <strong> auprès de la zone de police</strong> qui a ordonné la saisie. Elle vous dira quoi faire.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Au téléphone</span>
              <h2>Ce qu’il faut nous dire</h2>
              <p>Plus c’est précis, plus on arrive vite. Quatre choses suffisent.</p>
            </div>
            <div className="steps four">
              <div className="step"><span className="km">01</span><h4>Où vous êtes</h4>
                <p>Commune et rue. Sur autoroute&nbsp;: la borne kilométrique et le sens de circulation.</p></div>
              <div className="step"><span className="km">02</span><h4>Le véhicule</h4>
                <p>Marque, modèle, plaque. Et s’il est électrique ou hybride.</p></div>
              <div className="step"><span className="km">03</span><h4>Son état</h4>
                <p>Il roule encore&nbsp;? Il est sur ses quatre roues&nbsp;? Il gêne la circulation&nbsp;?</p></div>
              <div className="step"><span className="km">04</span><h4>Votre assistance</h4>
                <p>Si vous en avez une, dites-le&nbsp;: dans beaucoup de cas c’est elle qui prend l’intervention en charge.</p></div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
