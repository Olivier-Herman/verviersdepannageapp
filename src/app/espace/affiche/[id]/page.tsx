// Affiche A4 à imprimer : le QR code du garage pour ses clients (Olivier 10/10/2026).
/* eslint-disable @next/next/no-img-element */
import { redirect, notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { getEspaceSession } from '@/lib/espace/session'
import { createAdminClient } from '@/lib/supabase'
import { IMG } from '../../_ui/suivi'
import Imprimer from './Imprimer'

export const dynamic = 'force-dynamic'

export default async function Affiche({ params }: { params: { id: string } }) {
  const s = await getEspaceSession()
  if (!s) redirect('/espace/connexion')
  if (s.compte.role === 'collaborateur' || !s.societes.some(x => x.id === params.id)) notFound()
  const { data: so } = await createAdminClient().from('espace_societes').select('nom, couleur, clients_slug').eq('id', params.id).maybeSingle()
  if (!so?.clients_slug) notFound()
  const lien = `${(process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')}/d/${so.clients_slug}`
  const qr = await QRCode.toDataURL(lien, { width: 900, margin: 1, color: { dark: '#151a2d', light: '#ffffff' } })
  const couleur = so.couleur || '#2f6fde'
  return (
    <div style={{ background: '#e9e4de', minHeight: '100dvh', padding: 16 }}>
      <style>{`@page{size:A4;margin:0}@media print{.no-print{display:none!important}body,.esp{background:#fff!important}.feuille{box-shadow:none!important;margin:0!important}}`}</style>
      <Imprimer />
      <div className="feuille" style={{ width: '210mm', maxWidth: '100%', minHeight: '297mm', margin: '0 auto', background: '#fff', boxShadow: '0 20px 50px -20px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', height: '92mm', overflow: 'hidden', background: '#1a1f33', color: '#fff' }}>
          <img src={IMG.nuit} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(14,17,30,.1),rgba(14,17,30,.85))' }} />
          <div style={{ position: 'absolute', left: '14mm', right: '14mm', bottom: '10mm' }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#ffc9a8' }}>Verviers Dépannage <span style={{ color: '#fff', background: couleur, borderRadius: 8, padding: '3px 9px', letterSpacing: '.04em', textTransform: 'none', marginLeft: 6 }}>avec {so.nom}</span></div>
            <h1 style={{ fontSize: 46, lineHeight: 1.05, fontWeight: 800, marginTop: 8 }}>En panne ? On arrive.</h1>
          </div>
        </div>
        <div style={{ padding: '12mm 14mm', display: 'grid', gridTemplateColumns: '1fr 80mm', gap: '10mm', alignItems: 'center', flex: 1 }}>
          <div>
            <p style={{ fontSize: 19, color: '#3a4258', margin: 0 }}>Scannez ce code avec votre téléphone : vous commandez votre dépannage en 30 secondes, 24 h/24.</p>
            <ol style={{ fontSize: 17, color: '#151a2d', lineHeight: 1.6, paddingLeft: 22, marginTop: 18 }}>
              <li><b>Inscrivez-vous une fois</b> : vos coordonnées et votre véhicule.</li>
              <li><b>En panne</b> : on vous localise, vous dites ce qui se passe.</li>
              <li><b>Suivez</b> l’arrivée du dépanneur, étape par étape.</li>
            </ol>
            <p style={{ fontSize: 13, color: '#6c7387', marginTop: 18 }}>Ou ouvrez : <b style={{ color: '#151a2d' }}>{lien.replace(/^https?:\/\//, '')}</b></p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <img src={qr} alt="QR code" style={{ width: '80mm', height: '80mm', border: `3px solid ${couleur}`, borderRadius: 18, padding: 8 }} />
            <div style={{ fontWeight: 800, marginTop: 8, color: '#151a2d' }}>Scannez-moi</div>
          </div>
        </div>
        <div style={{ padding: '6mm 14mm', background: '#faf7f3', borderTop: '1px solid #f1e9e1', fontSize: 12, color: '#6c7387' }}>Verviers Dépannage · dépannage et remorquage 24 h/24, 7 j/7 · partenaire de votre garage {so.nom}</div>
      </div>
    </div>
  )
}
