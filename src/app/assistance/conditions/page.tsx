// Conditions du service VD Assistance (Olivier 10/10/2026) : ce que le client accepte en cochant la case avant une
// commande à sa charge (demande d'intervention immédiate, paiement au chauffeur, déplacement pour rien).
import { createAdminClient } from '@/lib/supabase'
import { getBusinessText } from '@/lib/settings/business'

export const metadata = { title: 'Conditions du service — VD Assistance' }
export const dynamic = 'force-dynamic'

const S = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <section style={{ marginTop: 18 }}><h3>{t}</h3><div style={{ color: 'var(--ink2)', fontSize: 14.5 }}>{children}</div></section>
)

export default async function Conditions() {
  // Forfait du déplacement pour rien : lu dans les grilles « clients » des garages (TVAC).
  const { data } = await createAdminClient().from('source_tariffs').select('unit_price').like('source', '%\\_clients').eq('mission_type', 'trajet_vide').is('effective_to', null).limit(1)
  const tel = await getBusinessText('telephone_depannage_public').catch(() => '')
  const dpr = data?.[0]?.unit_price ? (Math.round(Number(data[0].unit_price) * 121) / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' }) : null
  return (
    <div className="dcl-app">
      <div className="dcl-pad">
        <a className="link" href="/assistance" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>← Retour</a>
        <h2 style={{ marginTop: 6 }}>Conditions du service</h2>
        <p className="dcl-sub">VD Assistance — Verviers Dépannage SA, Lefin 12, 4860 Pepinster — BE 0460.759.205. Mise à jour : 10 octobre 2026.</p>
        <S t="Le service">
          <p>VD Assistance permet aux clients des garages partenaires de Verviers Dépannage de commander un dépannage ou un remorquage, 24 h/24. L’intervention part en dépannage sur place ; si le véhicule ne peut pas être réparé sur place, le chauffeur le remorque jusqu’au garage relié à ce véhicule. En dehors des heures d’ouverture de ce garage, le véhicule est mis à l’abri dans notre dépôt, puis livré au garage dès son ouverture.</p>
        </S>
        <S t="Prise en charge par votre garage">
          <p>Si votre garage a activé son assistance pour votre véhicule, l’intervention lui est facturée et vous n’avez rien à payer. L’application vous l’indique avant l’envoi de la demande.</p>
        </S>
        <S t="Prix et paiement, quand le dépannage est à votre charge">
          <ul>
            <li>Avant d’envoyer votre demande, l’application affiche une estimation TVAC du dépannage sur place et du remorquage jusqu’à votre garage. Ce sont des estimations : le montant dépend de l’heure, du trajet réel et de l’intervention.</li>
            <li>Le chauffeur vous confirme le montant sur place, avant de charger votre véhicule.</li>
            <li>Vous réglez le chauffeur à la fin de l’intervention. La facture est établie à votre nom.</li>
          </ul>
        </S>
        <S t="Annulation et déplacement pour rien">
          <ul>
            <li>Vous pouvez annuler sans frais tant que le dépanneur n’est pas parti.</li>
            <li>Si vous annulez après son départ, ou si vous êtes absent à son arrivée, le déplacement vous est facturé{dpr ? ` : ${dpr} TVAC` : ''}.</li>
          </ul>
        </S>
        <S t="Intervention immédiate et droit de rétractation">
          <p>En commandant, vous demandez expressément que l’intervention commence immédiatement. Une fois l’intervention entièrement réalisée, vous ne pouvez plus exercer de droit de rétractation (Code de droit économique, article VI.53).</p>
        </S>
        <S t="Vos données">
          <p>Voir la page <a className="link" href="/assistance/confidentialite">Confidentialité</a>.</p>
        </S>
        <S t="Contact">
          <p>Verviers Dépannage, 24 h/24{tel ? ` : ${tel}` : ''} — info@verviersdepannage.be</p>
        </S>
      </div>
    </div>
  )
}
