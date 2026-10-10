// Politique de confidentialité de VD Assistance (app des clients des garages partenaires, Olivier 10/10/2026).
export const metadata = { title: 'Confidentialité — VD Assistance' }

const S = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <section style={{ marginTop: 18 }}><h3>{t}</h3><div style={{ color: 'var(--ink2)', fontSize: 14.5 }}>{children}</div></section>
)

export default function Confidentialite() {
  return (
    <div className="dcl-app">
      <div className="dcl-pad">
        <a className="link" href="/assistance" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>← Retour</a>
        <h2 style={{ marginTop: 6 }}>Confidentialité</h2>
        <p className="dcl-sub">VD Assistance, l’application de dépannage de Verviers Dépannage SA pour les clients de ses garages partenaires. Mise à jour : 10 octobre 2026.</p>
        <S t="Qui traite vos données">
          <p>Verviers Dépannage SA, Lefin 12, 4860 Pepinster, Belgique — BE 0460.759.205 — info@verviersdepannage.be</p>
        </S>
        <S t="Ce que nous collectons">
          <ul>
            <li><b>Votre inscription</b> : prénom, nom, téléphone, adresse mail, adresse postale, plaque, marque et modèle de votre véhicule, et le garage partenaire que vous choisissez.</li>
            <li><b>Votre position</b> : seulement quand vous touchez « Me localiser » au moment de commander un dépannage, pour envoyer le dépanneur au bon endroit. Elle n’est jamais suivie en permanence ni en arrière-plan.</li>
            <li><b>Vos demandes de dépannage</b> : lieu, panne décrite, suivi de l’intervention, montant.</li>
            <li><b>Les notifications</b>, si vous les acceptez : un identifiant technique de votre téléphone, utilisé seulement pour vous prévenir de l’avancement de votre dépannage (demande acceptée, chauffeur en route, chauffeur arrivé).</li>
          </ul>
        </S>
        <S t="Pourquoi">
          <ul>
            <li>Organiser et réaliser votre dépannage ou remorquage, et vous en montrer le suivi.</li>
            <li>Établir la facture, à votre nom ou à celui de votre garage s’il vous couvre.</li>
            <li>Permettre à votre garage de vérifier que vous êtes son client et d’activer sa prise en charge.</li>
          </ul>
          <p>Base légale : l’exécution du service que vous demandez, et nos obligations comptables.</p>
        </S>
        <S t="Avec qui">
          <p>Votre garage partenaire voit votre inscription (coordonnées, véhicule) et vos demandes. Vos données sont hébergées dans l’Union européenne (Supabase, Vercel) et la facturation est gérée dans notre logiciel de gestion. Elles ne sont jamais vendues ni utilisées pour de la publicité.</p>
        </S>
        <S t="Combien de temps">
          <p>Votre compte est conservé jusqu’à ce que vous le supprimiez. Les factures et pièces comptables sont conservées pendant la durée imposée par la loi belge.</p>
        </S>
        <S t="Vos droits">
          <p>Vous pouvez supprimer votre compte à tout moment dans l’application (« Supprimer mon compte », en bas de l’écran). Pour accéder à vos données, les corriger ou vous opposer à un traitement : info@verviersdepannage.be. Vous pouvez aussi vous adresser à l’Autorité de protection des données (autoriteprotectiondonnees.be).</p>
        </S>
      </div>
    </div>
  )
}
