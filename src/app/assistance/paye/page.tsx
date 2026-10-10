// Retour de la page de paiement SumUp (VD Assistance, Olivier 10/10/2026). Le paiement est vérifié chez SumUp et
// enregistré côté serveur ; cette page rassure le client et le ramène à son suivi.
export const metadata = { title: 'Paiement — VD Assistance' }

export default function Paye() {
  return (
    <div className="dcl-app">
      <div className="dcl-pad" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div style={{ width: 72, height: 72, borderRadius: 24, background: '#e5f6ee', color: '#13704b', display: 'grid', placeItems: 'center', margin: '0 auto', fontSize: 34, fontWeight: 800 }}>✓</div>
        <h2 style={{ marginTop: 18 }}>Merci !</h2>
        <p className="dcl-sub" style={{ maxWidth: 340, margin: '8px auto 0' }}>Votre paiement est en cours de confirmation. Le chauffeur est prévenu dès qu’il est validé, et la facture vous sera envoyée.</p>
        <a className="btn btn-red" href="/assistance" style={{ marginTop: 22 }}>Retour au suivi</a>
        <p className="dcl-small">Vous utilisez l’app VD Assistance ? Vous pouvez aussi simplement y revenir.</p>
      </div>
    </div>
  )
}
