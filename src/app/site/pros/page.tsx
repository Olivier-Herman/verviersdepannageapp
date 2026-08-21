export const metadata = {
  title: 'Garages, assureurs & assisteurs',
  description:
    'Transport de véhicules roulants et non roulants, dépôt-reprise, gardiennage en parc fermé, '
  + 'missions d’assistance 24h/24 avec suivi horodaté et photos.',
}

export default function Pros() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Garages · assureurs · assisteurs</span>
          <h1>Un véhicule à déplacer&nbsp;?<br />On s’en occupe.</h1>
          <p style={{ maxWidth: '60ch' }}>
            Garagiste, carrossier, concessionnaire, loueur, société d’assistance. Un véhicule ne roule plus,
            doit passer au contrôle technique, changer de site, partir en expertise ou revenir de chez un client.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="cards">
            <div className="card"><div className="card-body">
              <h3>Garages &amp; concessions</h3>
              <ul className="tight">
                <li>Transport de véhicules roulants et non roulants, à l’unité ou en série.</li>
                <li>Dépôt et reprise chez le client final.</li>
                <li>Véhicules accidentés, sans clés, sans freins, roues bloquées.</li>
                <li>Gardiennage en parc fermé entre deux étapes.</li>
                <li>Interventions planifiées, avec créneau confirmé.</li>
              </ul>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>Sociétés d’assistance</h3>
              <ul className="tight">
                <li>Couverture de l’arrondissement de Verviers et des Fagnes, 24h/24.</li>
                <li>Acceptation ou refus rapide&nbsp;: pas de mission qui traîne sans réponse.</li>
                <li>Suivi horodaté&nbsp;: accepté, en route, sur place, chargé, livré.</li>
                <li>Signature du client sur place, rapport d’intervention.</li>
                <li>Facturation conforme à votre grille et à vos formats.</li>
              </ul>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>Zones de police &amp; autorités</h3>
              <ul className="tight">
                <li>Enlèvements sur réquisition, 24h/24.</li>
                <li>Accidents, véhicules abandonnés sur la voie publique, stationnement gênant.</li>
                <li>Parc fermé, traçabilité complète de l’entrée à la restitution.</li>
                <li>États de frais au tarif officiel, transmis dans les formes.</li>
              </ul>
            </div></div>
          </div>
        </div>
      </section>
    </>
  )
}
