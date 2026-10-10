'use client'
// « Mes clients » (Olivier 10/10/2026, prototype validé) : le garage active le service, diffuse son QR code
// et classe chaque véhicule inscrit chez lui : assistance (facturé au garage) ou pas (le client paie le chauffeur).
// Le garage d'un véhicule ne se change pas ici : seul le dispatch de Verviers Dépannage le réaffecte.
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useEspace } from '../EspaceShell'
import { Plaque, jour } from '../../_ui/suivi'

interface VehiculeG { id: string; plaque: string; marque: string | null; modele: string | null; assistance: boolean; assistance_le: string | null; created_at: string; commandes: number; garage: string; client: { prenom: string; nom: string; tel: string; email: string; adresse: string } }
interface SocieteG { id: string; nom: string; couleur: string | null; actif: boolean; lien: string; vehicules: VehiculeG[]; commission: { htva: number; base: number; nb: number; pct: number } }

const eur = (v: number) => v.toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export default function MesClients() {
  const { compte } = useEspace()
  const [d, setD] = useState<{ gestionnaire: boolean; mois: string; societes: SocieteG[] } | null>(null)
  const [toast, setToast] = useState('')
  const [coupe, setCoupe] = useState<SocieteG | null>(null)
  const charger = useCallback(async () => {
    const r = await fetch('/api/espace/clients', { cache: 'no-store' })
    if (r.status === 401) { location.href = '/espace/connexion'; return }
    if (r.ok) setD(await r.json())
  }, [])
  useEffect(() => { charger() }, [charger])
  const montrer = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600) }
  const patch = async (body: any, msg: string) => {
    const r = await fetch('/api/espace/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    montrer(r.ok ? msg : j.error || 'Erreur'); charger()
  }

  if (compte.role === 'collaborateur') return <div className="wrap" style={{ paddingTop: 30, color: 'var(--ink2)' }}>Cette page est réservée au garage.</div>
  if (!d) return <div className="wrap" style={{ paddingBlock: 26 }}><div className="card" style={{ height: 180 }} /></div>
  const moisLib = NOMS_MOIS[Number(d.mois.slice(5, 7)) - 1]

  return (
    <div className="wrap" style={{ maxWidth: 1060, paddingBlock: 26, display: 'grid', gap: 26 }}>
      {d.societes.map(s => (
        <section key={s.id} className="rise">
          <div className="cl-top">
            <div className="card" style={{ padding: 22 }}>
              <h1 style={{ fontSize: 26 }}>Dépannage commandé par vos clients{d.societes.length > 1 ? ` — ${s.nom}` : ''}</h1>
              <p style={{ color: 'var(--ink2)' }}>Vos clients s’inscrivent avec votre QR code et commandent leur dépannage eux-mêmes. Vous décidez qui est couvert par votre assistance.</p>
              <button className="cl-switch" disabled={!d.gestionnaire} onClick={() => s.actif ? setCoupe(s) : patch({ societeId: s.id, actif: true }, `Service activé pour ${s.nom}`)}>
                <span className={`cl-tg ${s.actif ? 'on' : ''}`} />
                <span><b>{s.actif ? `Service activé pour ${s.nom}` : 'Service désactivé'}</b><br />
                  <span style={{ fontSize: 13, color: 'var(--mute)' }}>{s.actif ? 'Vos clients peuvent s’inscrire et commander.' : d.gestionnaire ? 'Touchez pour l’activer. Tant qu’il est coupé, le QR code affiche « service indisponible ».' : 'Seul le gestionnaire peut l’activer.'}</span></span>
              </button>
              <div className="cl-kpi">
                <div><b>{s.vehicules.length}</b><span>véhicules inscrits</span></div>
                <div><b>{s.vehicules.filter(c => c.assistance).length}</b><span>avec assistance</span></div>
                <div><b>{eur(s.commission.htva)}</b><span>commission de {moisLib}*</span></div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--mute)', margin: '10px 0 0' }}>* {s.commission.pct} % du prix HTVA payé par vos clients sans assistance ({s.commission.nb} intervention{s.commission.nb > 1 ? 's' : ''} ce mois), reversés par une note de crédit en fin de mois. Les déplacements pour rien ne sont pas commissionnés.</p>
            </div>
            <QrCarte s={s} onCopie={() => montrer('Lien copié')} />
          </div>

          <div className="card" style={{ marginTop: 16, overflow: 'hidden' }}>
            <div style={{ padding: '18px 18px 4px' }}>
              <h3 style={{ fontSize: 18 }}>Véhicules inscrits chez vous</h3>
              <p style={{ color: 'var(--mute)', fontSize: 13, margin: '4px 0 0' }}>Un client peut avoir plusieurs véhicules, chacun relié à son garage. Un véhicule pas encore classé est payé par le client au chauffeur. Dès que vous cochez « Assistance », ses dépannages suivants vous sont facturés.</p>
            </div>
            {s.vehicules.length === 0 ? (
              <p style={{ padding: 18, color: 'var(--ink2)' }}>{s.actif ? 'Personne ne s’est encore inscrit. Diffusez votre QR code : vous recevez un mail à chaque véhicule inscrit.' : 'Activez le service, puis diffusez votre QR code.'}</p>
            ) : (
              <div className="cl-wrapx">
                <table className="cl-tbl">
                  <thead><tr><th>Client</th><th>Véhicule</th><th>Garage</th><th>Inscrit</th><th>Prise en charge</th></tr></thead>
                  <tbody>
                    {s.vehicules.map(v => (
                      <tr key={v.id}>
                        <td><b>{v.client.prenom} {v.client.nom}</b>{!v.assistance_le && <span className="cl-new">Nouveau</span>}<br /><small style={{ color: 'var(--mute)' }}>{v.client.tel} · {v.client.email}</small><br /><small style={{ color: 'var(--mute)' }}>{v.client.adresse}</small></td>
                        <td><Plaque v={v.plaque} /><br /><small>{[v.marque, v.modele].filter(Boolean).join(' ')}</small>{v.commandes > 0 && <><br /><small style={{ color: 'var(--mute)' }}>{v.commandes} dépannage{v.commandes > 1 ? 's' : ''}</small></>}</td>
                        <td><small>{v.garage}</small></td>
                        <td><small>{jour(v.created_at)}</small></td>
                        <td>
                          <div className="cl-seg">
                            <button className={v.assistance ? 'on a' : ''} onClick={() => !v.assistance && patch({ vehiculeId: v.id, assistance: true }, `${v.plaque} : assistance activée`)}>🛡️ Assistance</button>
                            <button className={!v.assistance ? 'on p' : ''} onClick={() => (v.assistance || !v.assistance_le) && patch({ vehiculeId: v.id, assistance: false }, `${v.plaque} : payé par le client`)}>💳 Pas d’assistance</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ))}
      {coupe && (
        <div className="modal">
          <div className="card">
            <h2 style={{ fontSize: 20 }}>Couper le service ?</h2>
            <p style={{ color: 'var(--ink2)' }}>Vos clients ne pourront plus commander depuis le QR code de {coupe.nom} : ils verront « service indisponible ». Les demandes en cours continuent normalement.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setCoupe(null)}>Annuler</button>
              <button className="btn btn-red" onClick={() => { patch({ societeId: coupe.id, actif: false }, 'Service coupé'); setCoupe(null) }}>Couper</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function QrCarte({ s, onCopie }: { s: SocieteG; onCopie: () => void }) {
  const [img, setImg] = useState('')
  useEffect(() => { QRCode.toDataURL(s.lien, { width: 360, margin: 1, color: { dark: '#151a2d', light: '#ffffff' } }).then(setImg).catch(() => {}) }, [s.lien])
  const copier = () => {
    navigator.clipboard?.writeText(s.lien).then(onCopie).catch(() => {
      const r = document.createRange(); const el = document.getElementById(`lien-${s.id}`)
      if (el) { r.selectNodeContents(el); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r) }
    })
  }
  return (
    <div className="card">
      <div className="cl-qr">
        {img ? <img src={img} alt={`QR code ${s.nom}`} /> : <div style={{ width: 132, height: 132 }} />}
        <div style={{ flex: 1, minWidth: 200 }}>
          <b>Votre QR code</b>
          <p style={{ fontSize: 13, color: 'var(--ink2)', margin: '4px 0 0' }}>À afficher à l’atelier, à coller sur vos porte-clés, à mettre sur vos factures…</p>
          <div className="cl-lien" id={`lien-${s.id}`}>{s.lien.replace(/^https?:\/\//, '')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="btn btn-ghost" style={{ minHeight: 44, flex: 1 }} href={`/espace/affiche/${s.id}`} target="_blank" rel="noreferrer">Imprimer l’affiche</a>
            <button className="btn btn-ghost" style={{ minHeight: 44, flex: 1 }} onClick={copier}>Copier le lien</button>
          </div>
        </div>
      </div>
    </div>
  )
}
