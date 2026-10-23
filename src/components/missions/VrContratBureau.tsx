'use client'
// src/components/missions/VrContratBureau.tsx — contrat VR VAB vu du bureau (Olivier 23/10/2026).
// Tant que l'encodage automatique dans Comet n'existe pas, le bureau recopie ici l'onglet « Client »
// de l'assistant de document : les champs sont dans l'ordre de Comet, chacun avec un bouton Copier.
// Photos des documents et signature en vignettes ; état du véhicule noté par le chauffeur.

import { useEffect, useState } from 'react'

const PROP: Record<string, string> = { propre: 'Propre', correct: 'Correct', sale: 'Sale' }
const PHOTO_LBL: Record<string, string> = { id_recto: 'Carte d’identité recto', id_verso: 'Carte d’identité verso', permis_recto: 'Permis recto', permis_verso: 'Permis verso' }

export default function VrContratBureau({ missionId }: { missionId: string }) {
  const [d, setD] = useState<any>(null)
  const [copie, setCopie] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const charger = () => fetch(`/api/missions/${missionId}/vr-contrat`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(setD).catch(() => {})
  useEffect(() => { charger() }, [missionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null
  const c = d.contrat
  if (!c) return (
    <div className="bg-surface border rounded-2xl p-5">
      <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-2">🚗 Contrat véhicule de remplacement VAB</h3>
      <p className="text-ink-secondary text-sm">Pas encore commencé : le chauffeur le remplit avec le client à la livraison (bouton « Compléter info VR » de sa fiche).</p>
    </div>
  )
  const av = d.avancement || {}
  const v = c.vehicule || {}
  const copier = async (k: string, val: string) => {
    try { await navigator.clipboard.writeText(val); setCopie(k); setTimeout(() => setCopie(null), 1200) } catch {}
  }
  const marquer = async (comet: 'encode' | 'a_encoder') => {
    setBusy(true)
    try { await fetch(`/api/missions/${missionId}/vr-contrat`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comet }) }); await charger() } finally { setBusy(false) }
  }
  const statut = c.status === 'complet' ? (c.comet_status === 'encode' ? { t: 'Encodé dans Comet', cls: 'bg-green-100 text-green-800' } : { t: 'Complet — à encoder dans Comet', cls: 'bg-amber-100 text-amber-900' })
    : c.signed_at ? { t: 'Signé — état du véhicule à compléter par le chauffeur', cls: 'bg-blue-100 text-blue-900' }
    : c.expire ? { t: 'Lien du client expiré — le chauffeur peut le rouvrir', cls: 'bg-gray-100 text-gray-800' }
    : { t: `En cours chez le client (photos ${av.photos || 0}/4)`, cls: 'bg-blue-100 text-blue-900' }

  return (
    <div className="bg-surface border rounded-2xl p-5 grid grid-cols-1 gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide">🚗 Contrat véhicule de remplacement VAB</h3>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statut.cls}`}>{statut.t}</span>
      </div>

      <div>
        <p className="text-ink font-semibold text-sm mb-1.5">Client <span className="text-ink-muted font-normal">(onglet « Client » de Comet, dans l’ordre)</span></p>
        <div className="divide-y border rounded-xl overflow-hidden">
          {(d.lignes as [string, string][]).map(([k, val]) => (
            <div key={k} className="flex items-center gap-2 px-3 min-h-[44px]">
              <span className="text-ink-muted text-xs w-28 sm:w-40 shrink-0">{k}</span>
              <span className="text-ink text-sm font-medium flex-1 min-w-0 break-all">{val || <span className="text-ink-faint">—</span>}</span>
              {val && <button onClick={() => copier(k, val)} className="text-xs px-2.5 min-h-[36px] rounded-lg border text-ink-secondary hover:bg-surface-hover shrink-0">{copie === k ? '✓ Copié' : 'Copier'}</button>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-ink font-semibold text-sm mb-1.5">Véhicule prêté <span className="text-ink-muted font-normal">(noté par le chauffeur)</span></p>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 text-sm">
          {[['Propreté intérieure', PROP[v.proprete_int] || '—'], ['Propreté extérieure', PROP[v.proprete_ext] || '—'], ['Kilométrage', v.km ? `${Number(v.km).toLocaleString('fr-BE')} km` : '—'], ['Carburant', v.carburant != null ? `${v.carburant} %` : '—']].map(([k, val]) => (
            <div key={k} className="rounded-xl border px-3 py-2"><span className="block text-ink-muted text-xs">{k}</span><b className="text-ink">{val}</b></div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
        {Object.entries(PHOTO_LBL).map(([k, lbl]) => d.photos?.[k] ? (
          <a key={k} href={d.photos[k]} target="_blank" rel="noopener" className="block rounded-xl border overflow-hidden">
            <img src={d.photos[k]} alt={lbl} className="w-full aspect-[1.586] object-cover" /><span className="block text-[11px] text-ink-muted px-2 py-1">{lbl}</span>
          </a>
        ) : (
          <div key={k} className="rounded-xl border border-dashed flex items-center justify-center aspect-[1.586] text-[11px] text-ink-faint text-center px-2">{lbl} — pas encore</div>
        ))}
        {d.signature_url && (
          <a href={d.signature_url} target="_blank" rel="noopener" className="block rounded-xl border overflow-hidden bg-white">
            <img src={d.signature_url} alt="Signature" className="w-full aspect-[1.586] object-contain" /><span className="block text-[11px] text-gray-600 px-2 py-1">Signature</span>
          </a>
        )}
      </div>

      {c.status === 'complet' && (
        c.comet_status === 'encode'
          ? <button disabled={busy} onClick={() => marquer('a_encoder')} className="justify-self-start text-xs text-ink-muted underline min-h-[44px]">Remettre « à encoder »</button>
          : <button disabled={busy} onClick={() => marquer('encode')} className="justify-self-start min-h-[44px] px-4 rounded-xl bg-green-700 text-white text-sm font-semibold disabled:opacity-50">✓ Encodé dans Comet</button>
      )}
    </div>
  )
}
