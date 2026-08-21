import Link  from 'next/link'
import Image from 'next/image'
import { TEL, TEL_HREF, DEPOTS } from '../_data'

export default function SiteFooter() {
  return (
    <footer className="vdsite-foot">
      <div className="wrap">
        <div className="grid">
          <div>
            <Image src="/vd-logo-dark.png" alt="Verviers Dépannage" width={820} height={456}
              style={{ height: 52, width: 'auto' }} />
            <p style={{ color: '#C4C6C8' }}>
              Dépannage, remorquage et fourrière dans l’arrondissement de Verviers, les Fagnes
              et la vallée de l’Amblève. 24h/24, 7j/7.
            </p>
            <p style={{ marginTop: 14 }}>
              <a className="tel-btn" href={TEL_HREF}>
                <span className="tel-dot" aria-hidden="true" />{TEL}
              </a>
            </p>
          </div>
          <div>
            <h4>Services</h4>
            <ul>
              <li><Link href="/site/depannage">Dépannage &amp; remorquage</Link></li>
              <li><Link href="/site/fourriere">Fourrière</Link></li>
              <li><Link href="/site/circuit">Circuit &amp; événements</Link></li>
              <li><Link href="/site/vente">Véhicules à vendre</Link></li>
              <li><Link href="/site/pros">Garages &amp; assisteurs</Link></li>
            </ul>
          </div>
          <div>
            <h4>Dépôts</h4>
            <ul>
              {DEPOTS.map(d => <li key={d.nom}>{d.nom} — {d.adresse[0]}</li>)}
            </ul>
          </div>
          <div>
            <h4>Infos</h4>
            <ul>
              <li><Link href="/site/contact">Contact</Link></li>
              <li><Link href="/site/mentions-legales">Mentions légales</Link></li>
              <li><Link href="/site/confidentialite">Politique de confidentialité</Link></li>
              <li><Link href="/site/vente">Conditions de vente</Link></li>
            </ul>
          </div>
        </div>
        <div className="bottom">
          <span>© {new Date().getFullYear()} Verviers Dépannage</span>
          <span>Rue Lefin 12, 4860 Pepinster</span>
          <span>TVA BE 0460.759.205</span>
        </div>
      </div>
    </footer>
  )
}
