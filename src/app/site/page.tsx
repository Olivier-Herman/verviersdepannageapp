import Link from 'next/link'
import {
  TEL, TEL_HREF, CHIFFRES, CHIFFRES_2, TICKER,
  COMMUNES, COMMUNES_AUTRES, DEPOTS, ASSISTEURS,
} from './_data'

export const metadata = {
  title: 'Verviers Dépannage — dépannage et remorquage 24h/24',
  description:
    'Une panne, un accident, une voiture immobilisée ? Dépannage et remorquage 24h/24 dans la région '
  + 'verviétoise, les Fagnes et la vallée de l’Amblève. 087 35 18 20.',
}

export default function SiteAccueil() {
  return (
    <>
      <div className="hero">
        <div className="wrap hero-in">
          <div className="stack g22">
            <span className="borne on-dark">Urgence 24h/24 · 7j/7</span>
            <h1>Une panne, un accident,<br />une voiture immobilisée&nbsp;?<br /><em>On arrive.</em></h1>
            <p className="hero-lede">
              Dépannage et remorquage dans toute la région verviétoise, les Fagnes et la vallée
              de l’Amblève. Un seul numéro, jour et nuit, week-ends et jours fériés compris.
            </p>
            <div><a className="big-tel" href={TEL_HREF}>☎ <span className="num">{TEL}</span></a></div>
            <p className="hero-sub">
              Cette nuit comme les autres, quelqu’un décroche. En moyenne 3 à 4 interventions entre 22h et 6h.
            </p>
          </div>
          <div className="ph" style={{ aspectRatio: '4 / 3' }}>
            <span className="ph-label">Photo à réaliser<br />— dépanneuse de nuit,<br />gyrophares allumés —</span>
          </div>
        </div>

        <div className="wrap">
          <div className="paths">
            <Link className="path" href="/site/depannage">
              <span className="num">01</span>
              <h3>Je suis en panne ou accidenté</h3>
              <p>Vous êtes sur la route, on vous prend en charge et on vous dit dans combien de temps on est là.</p>
              <span className="go">Ce qui se passe →</span>
            </Link>
            <Link className="path" href="/site/fourriere">
              <span className="num">02</span>
              <h3>Ma voiture a été enlevée</h3>
              <p>Véhicule saisi ou déplacé par la police&nbsp;: la procédure, les documents, les frais officiels.</p>
              <span className="go">La marche à suivre →</span>
            </Link>
            <Link className="path" href="/site/pros">
              <span className="num">03</span>
              <h3>Je suis un pro</h3>
              <p>Garage, assureur, assisteur, organisateur d’événement. Transport, missions, couverture.</p>
              <span className="go">Nos services pro →</span>
            </Link>
          </div>
        </div>
        <div className="hazard" aria-hidden="true" />
      </div>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-in">
          {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}</span>)}
        </div>
      </div>

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">L’été 2026 en chiffres</span>
            <h2>Ce que ça donne, concrètement</h2>
            <p>
              Pas des promesses&nbsp;: ce sont nos chiffres réels du 1<sup>er</sup> juin au 20 août 2026,
              extraits de notre système de dispatch.
            </p>
          </div>
          <div className="stats">
            {CHIFFRES.map(c => (
              <div className="stat" key={c.label}><b>{c.n}</b><span>{c.label}</span><i>{c.src}</i></div>
            ))}
          </div>
          <div className="stats">
            {CHIFFRES_2.map(c => (
              <div className="stat" key={c.label}><b>{c.n}</b><span>{c.label}</span><i>{c.src}</i></div>
            ))}
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Nos métiers</span>
            <h2>Quatre activités, un seul numéro</h2>
          </div>
          <div className="cards four">
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — chargement<br />sur plateau</span></div>
              <div className="card-body">
                <h3>Dépannage &amp; remorquage</h3>
                <p>
                  Batterie, crevaison, panne sèche, clés enfermées&nbsp;: près d’un tiers de nos interventions
                  se règlent au bord de la route. Sinon, on remorque vers le garage de votre choix.
                </p>
                <Link className="card-link" href="/site/depannage">Comment ça se passe →</Link>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — parc fourrière,<br />vue d’ensemble</span></div>
              <div className="card-body">
                <h3>Fourrière &amp; véhicules saisis</h3>
                <p>
                  Nous assurons la fourrière pour les zones de police de la région. Parc fermé et surveillé,
                  frais au tarif officiel des frais de justice.
                </p>
                <Link className="card-link" href="/site/fourriere">Récupérer mon véhicule →</Link>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — dépanneuse<br />dans le paddock</span></div>
              <div className="card-body">
                <h3>Circuit &amp; événements</h3>
                <p>
                  Spa-Francorchamps, Francofolies, grandes manifestations. Un point d’appui à Francorchamps
                  et l’habitude des véhicules qui n’aiment pas les sangles ordinaires.
                </p>
                <Link className="card-link" href="/site/circuit">Notre activité circuit →</Link>
              </div>
            </div>
            <div className="card">
              <div className="ph"><span className="ph-label">Photo — véhicule,<br />3/4 avant</span></div>
              <div className="card-body">
                <h3>Véhicules à vendre</h3>
                <p>
                  Nous mettons régulièrement des véhicules en vente, roulants ou pour pièces. Photos,
                  kilométrage, état&nbsp;: vous déposez votre offre en ligne.
                </p>
                <Link className="card-link" href="/site/vente">Voir les véhicules →</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">De l’appel à la restitution</span>
            <h2>Comment ça se passe</h2>
          </div>
          <div className="steps">
            <div className="step"><span className="km">KM 0</span><h4>Vous appelez</h4>
              <p>On note où vous êtes exactement, ce qui s’est passé, et si vous avez une assistance.</p></div>
            <div className="step"><span className="km">KM 1</span><h4>On envoie le bon camion</h4>
              <p>Voiture, utilitaire, camping-car, électrique ou poids lourd&nbsp;: ce ne sont pas les mêmes engins.</p></div>
            <div className="step"><span className="km">KM 2</span><h4>Le chauffeur vous appelle</h4>
              <p>Il vous donne son heure d’arrivée depuis la route. Pas de fourchette vague.</p></div>
            <div className="step"><span className="km">KM 3</span><h4>Prise en charge</h4>
              <p>Le véhicule est photographié avant chargement. Vous savez ce qui est constaté, et quand.</p></div>
            <div className="step"><span className="km">KM 4</span><h4>Livraison</h4>
              <p>À l’adresse convenue, ou mise à l’abri dans notre parc le temps que vous décidiez.</p></div>
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">L’équipe</span>
            <h2>Une génération qui a appris le métier au volant, pas dans un bureau.</h2>
            <p>
              Verviers Dépannage est dirigé par des trentenaires qui ont commencé sur les camions. Ça se voit
              à deux endroits&nbsp;: on décroche vite, et on ne vous récite pas un script. Vingt-trois personnes,
              dont neuf chauffeurs, et quelqu’un derrière le téléphone à toute heure.
            </p>
          </div>
          <div className="cards">
            <div className="card"><div className="card-body">
              <h3>On développe nos propres outils</h3>
              <p>
                Dispatch, photos horodatées, suivi en temps réel, signature du client sur place, facturation&nbsp;:
                tout tourne sur un logiciel qu’on a écrit nous-mêmes, parce qu’aucun produit du marché ne faisait
                ce qu’on voulait. C’est ce qui nous permet de vous dire, à la minute près, où en est votre véhicule.
              </p>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>On répond vite, sinon ça ne sert à rien</h3>
              <p>
                Une demande d’assistance qui traîne, c’est un automobiliste qui attend sur une bande d’arrêt
                d’urgence. Nos délais&nbsp;: 18 minutes de médiane entre le départ du camion et l’arrivée sur place,
                sept fois sur dix moins de trente minutes.
              </p>
            </div></div>
            <div className="card"><div className="card-body">
              <h3>On dit ce qu’on facture</h3>
              <p>
                Le montant est annoncé avant, pas découvert après. Pour la fourrière, c’est le tarif officiel
                des frais de justice, affiché noir sur blanc. Pour le reste, on vous le donne au téléphone.
              </p>
            </div></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Assistances &amp; assureurs</span>
            <h2>Deux missions sur trois nous arrivent d’une assistance</h2>
            <p>
              Si votre assistance nous a mandatés, vous n’avez rien à avancer pour la partie couverte par votre
              contrat. Ce qui reste éventuellement à votre charge vous est annoncé avant, jamais découvert après.
            </p>
          </div>
          <div className="logos">
            {ASSISTEURS.map(a => <div className="logo-cell" key={a}>{a}</div>)}
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap stack g32">
          <div className="sec-head">
            <span className="borne">Zone d’intervention</span>
            <h2>208 communes cet été. Voici les plus fréquentes.</h2>
            <p>
              Arrondissement de Verviers, pays de Herve, vallée de l’Amblève, Hautes Fagnes.
              Nos dépôts nous permettent de partir du point le plus proche.
            </p>
          </div>
          <div className="communes">
            {COMMUNES.map(([nom, n]) => (
              <span className="commune" key={nom}>{nom} <i>{n}</i></span>
            ))}
            <span className="commune" style={{ borderStyle: 'dashed' }}>
              <i>+ {COMMUNES_AUTRES} autres localités</i>
            </span>
          </div>
          <div className="depots">
            {DEPOTS.map(d => (
              <div className="depot" key={d.nom}>
                <span className="tag">{d.tag}</span>
                <h3>{d.nom}</h3>
                <address>{d.adresse.map((l, i) => <span key={i}>{l}<br /></span>)}</address>
                <p style={{ fontSize: '.9rem', color: 'var(--muted)' }}>{d.note}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '.92rem', color: 'var(--muted)' }}>
            Points d’appui complémentaires à Tiège (Jalhay) et Francorchamps, utilisés pour les Fagnes
            et les événements du circuit.
          </p>
        </div>
      </section>
    </>
  )
}
