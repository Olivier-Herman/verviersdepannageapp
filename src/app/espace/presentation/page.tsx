// /espace/presentation — vidéo de présentation des transports TGR (Olivier 16/11/2026). Page publique :
// c'est le lien envoyé au demandeur avec son invitation, avant sa première connexion.
import type { Metadata } from 'next'
import Link from 'next/link'
import { getBusinessText } from '@/lib/settings/business'
import { Marque } from '../_ui/suivi'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Vos transports TGR en ligne — Verviers Dépannage', robots: { index: false, follow: false } }

export default async function Presentation() {
  const tel = await getBusinessText('telephone_depannage_public').catch(() => '')
  return (
    <div className="wrap" style={{ maxWidth: 980, paddingBlock: '26px 48px' }}>
      <Marque />
      <div className="rise" style={{ marginTop: 26 }}>
        <h1 style={{ fontSize: 34 }}>Vos transports TGR, commandés en ligne</h1>
        <p style={{ color: 'var(--ink2)', margin: '6px 0 18px', maxWidth: '62ch' }}>Deux minutes pour tout voir : la connexion sans mot de passe, la commande en deux étapes, le suivi en direct, le rapport et la facture.</p>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- les sous-titres sont incrustés dans l'image */}
      <video controls playsInline preload="metadata" poster="/noprecache/espace/presentation-transports.jpg" src="/noprecache/espace/presentation-transports.mp4"
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: 22, background: '#151a2d', boxShadow: '0 18px 40px -22px rgba(20,25,45,.5)' }} />
      <div className="card" style={{ padding: 20, marginTop: 18, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <b className="disp" style={{ fontSize: 18 }}>Prêt à commander ?</b>
          <p style={{ color: 'var(--ink2)', margin: '2px 0 0' }}>Connectez-vous avec l’adresse mail de votre société : vous recevez un code, sans mot de passe à retenir.</p>
        </div>
        <Link href="/espace/connexion" className="btn btn-red" style={{ textDecoration: 'none', color: '#fff' }}>Ouvrir mon espace</Link>
      </div>
      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--mute)', marginTop: 18 }}>Une question ? Appelez-nous{tel && <b style={{ color: 'var(--ink)', whiteSpace: 'nowrap', userSelect: 'all' }}> {tel}</b>}</p>
    </div>
  )
}
