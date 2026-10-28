'use client'

// Plantage hors d'une page (menus, fenêtres communes) : message en français + rapport automatique
// au lieu de « Application error » en anglais (Olivier 21/10/2026).
import './globals.css'
import { useEffect, useState } from 'react'
import SignalerErreur from '@/components/SignalerErreur'
import { isChunkError, reloadOnce } from '@/lib/client/chunk-reload'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Ancienne version après une mise en ligne : on recharge au lieu d'afficher l'erreur (28/10/2026).
  const [maj, setMaj] = useState(() => isChunkError(error))
  useEffect(() => { if (maj && !reloadOnce('morceau de code introuvable (écran d’erreur)')) setMaj(false) }, [maj])
  if (maj) return (
    <html lang="fr"><body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F5F7FA', color: '#1E293B' }}>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>🔄 Mise à jour de l’app…</div>
    </body></html>
  )
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F5F7FA', color: '#1E293B' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 360, width: '100%', background: '#fff', border: '1px solid #FCD34D', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>⚠️</div>
            <h1 style={{ fontSize: 18, margin: '8px 0' }}>Un souci d’affichage</h1>
            <p style={{ fontSize: 14, color: '#334155', margin: '0 0 16px' }}>Le problème est enregistré. Réessaie ; si ça bloque encore, ferme complètement l’app et rouvre-la.</p>
            {/* Enregistre le plantage et propose de le signaler à Sam (26/10/2026). */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <SignalerErreur message={error?.message || 'Plantage de l’app'} where="global"
                context={{ pile: String(error?.stack || '').slice(0, 1500), digest: error?.digest || null }} />
            </div>
            <button onClick={() => reset()} style={{ width: '100%', minHeight: 48, border: 0, borderRadius: 12, background: '#1D4ED8', color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>↻ Réessayer</button>
            <button onClick={() => { location.href = '/mission' }} style={{ width: '100%', minHeight: 48, borderRadius: 12, border: '1px solid #CBD5E1', background: '#fff', color: '#1E293B', fontWeight: 600, fontSize: 15 }}>← Mes missions</button>
          </div>
        </div>
      </body>
    </html>
  )
}
