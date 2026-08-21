import { TARIF_FOURRIERE, TARIF_MAL_GAREE } from '../_data'

export const metadata = {
  title: 'Fourrière — récupérer un véhicule saisi',
  description:
    'Votre véhicule a été enlevé par la police ? Procédure, documents à apporter, horaires et frais '
  + 'au tarif officiel des frais de justice. Pepinster, du lundi au vendredi de 9h à 17h.',
}

export default function Fourriere() {
  return (
    <>
      <section className="dark page-head">
        <div className="wrap stack g16">
          <span className="borne on-dark">Fourrière · zones de police</span>
          <h1>Votre véhicule a été enlevé&nbsp;?<br />Voici exactement quoi faire.</h1>
          <p style={{ maxWidth: '60ch' }}>
            Verviers Dépannage assure la fourrière pour les véhicules enlevés par la police dans la région.
            Il est peut-être chez nous — mais c’est la police qui décide de sa restitution, pas nous.
            Commencez toujours par elle.
          </p>
        </div>
      </section>
      <div className="hazard" aria-hidden="true" />

      <section>
        <div className="wrap stack g32">
          <div className="proc">
            <div className="proc-item">
              <span className="proc-n">1</span>
              <div className="proc-b">
                <h3>Appelez la zone de police</h3>
                <p>
                  Contactez la zone de police qui a ordonné l’enlèvement. Elle vous confirme où se trouve le
                  véhicule et vous délivre la <strong>levée de saisie</strong>, sans laquelle nous ne pouvons
                  rien vous restituer. Nous ne communiquons pas la présence d’un véhicule sans son autorisation.
                </p>
              </div>
            </div>
            <div className="proc-item">
              <span className="proc-n">2</span>
              <div className="proc-b">
                <h3>Rassemblez vos documents</h3>
                <ul className="tight">
                  <li>Votre carte d’identité.</li>
                  <li>La levée de saisie délivrée par la police.</li>
                  <li>Si vous n’êtes pas le titulaire&nbsp;: procuration écrite + copie de sa carte d’identité.</li>
                  <li>Véhicule de société&nbsp;: un document établissant la qualité du signataire.</li>
                </ul>
                <div className="callout">
                  <strong>Appelez-nous avant de venir.</strong> On vérifie en deux minutes que votre dossier
                  est complet — ça vous évite de faire le trajet pour rien.
                </div>
              </div>
            </div>
            <div className="proc-item">
              <span className="proc-n">3</span>
              <div className="proc-b">
                <h3>Venez au dépôt de Pepinster</h3>
                <p>
                  Rue Lefin 12, 4860 Pepinster. Fourrière accessible <strong>du lundi au vendredi, de 9h à
                  17h</strong>. Fermée les week-ends et jours fériés.
                </p>
              </div>
            </div>
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Les frais</span>
              <h2>Un tarif officiel, pas un tarif maison</h2>
              <p>
                Les frais d’enlèvement et de gardiennage d’un véhicule saisi relèvent du tarif des frais de
                justice. Ils sont les mêmes pour tout le monde et nous ne les fixons pas.
              </p>
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Poste</th><th>Base</th><th>Montant HTVA</th><th>Montant TVAC</th></tr>
                </thead>
                <tbody>
                  {TARIF_FOURRIERE.map(l => (
                    <tr key={l.poste}>
                      <td>{l.poste}</td><td>{l.base}</td>
                      <td className="num">{l.htva}</td><td className="num">{l.tvac}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '.92rem', color: 'var(--ink-2)' }}>
              Exemple&nbsp;: un véhicule enlevé à moins de 15 km et resté 12 jours au parc pendant la saisie
              représente 94,06 € + (12 × 1,56 €) + 37,67 € = <strong>150,45 € HTVA</strong>, soit 182,04 € TVAC.
            </p>
            <div className="callout">
              <strong>Attention à ce qui se passe après la levée de saisie.</strong> Tant que la saisie court,
              le gardiennage relève du tarif des frais de justice&nbsp;: 1,56 € par jour. Dès que la saisie est
              levée, si le véhicule reste chez nous, il occupe une place à nos conditions&nbsp;:
              <strong> 20 € HTVA par jour</strong>. Venez le chercher rapidement, la différence est de taille.
            </div>
            <p style={{ fontSize: '.9rem', color: 'var(--muted)' }}>
              Pour un cyclomoteur ou une moto, le gardiennage pendant la saisie est de 0,80 € HTVA par jour.
              Un enlèvement de nuit, un week-end ou un jour férié peut faire l’objet d’une majoration.
            </p>
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Stationnement gênant</span>
              <h2>Véhicule déplacé pour mal garée</h2>
              <p>
                Un véhicule enlevé parce qu’il gênait ne fait pas l’objet d’une saisie&nbsp;: pas de levée
                de saisie à obtenir, vous nous appelez directement. Les frais, eux, relèvent d’un tarif
                distinct de celui des frais de justice.
              </p>
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr><th>Poste</th><th>Base</th><th>Montant HTVA</th><th>Montant TVAC</th></tr>
                </thead>
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
          </div>

          <div className="stack g16">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="borne">Questions fréquentes</span>
              <h2>Ce qu’on nous demande tous les jours</h2>
            </div>
            <div className="proc">
              <div className="proc-item"><span className="proc-n">?</span><div className="proc-b">
                <h4>Comment savoir si ma voiture est chez vous&nbsp;?</h4>
                <p>Par la police. Nous ne pouvons pas confirmer la présence d’un véhicule sans son autorisation.</p>
              </div></div>
              <div className="proc-item"><span className="proc-n">?</span><div className="proc-b">
                <h4>Je n’ai plus les clés.</h4>
                <p>Dites-le-nous. Le véhicule peut être chargé et restitué sans clés, mais ça change
                l’organisation et il faut le prévoir.</p>
              </div></div>
              <div className="proc-item"><span className="proc-n">?</span><div className="proc-b">
                <h4>Ma voiture gênait, elle a été déplacée.</h4>
                <p>
                  Ce n’est pas une saisie&nbsp;: vous n’avez pas besoin d’une levée de saisie et vous pouvez
                  nous appeler directement. En revanche, ce n’est pas moins cher — le tarif est différent,
                  pas réduit. Voir la grille ci-dessous.
                </p>
              </div></div>
              <div className="proc-item"><span className="proc-n">?</span><div className="proc-b">
                <h4>Je ne veux pas récupérer le véhicule.</h4>
                <p>
                  Pour un véhicule <strong>saisi par la police</strong>, cette démarche se fait
                  <strong> auprès de la zone de police</strong> qui a ordonné la saisie, pas chez nous.
                  Si votre véhicule est chez nous à la suite d’une panne, d’un accident ou d’un enlèvement
                  pour stationnement gênant, la démarche se fait directement avec nous.
                </p>
              </div></div>
              <div className="proc-item"><span className="proc-n">?</span><div className="proc-b">
                <h4>Mon véhicule est-il en sécurité&nbsp;?</h4>
                <p>Parc fermé et surveillé. Chaque véhicule est repéré à l’emplacement près&nbsp;:
                on sait exactement où il se trouve.</p>
              </div></div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
