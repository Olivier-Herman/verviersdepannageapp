'use client'

// Onglet « Remises » de l'écran Domaine (Q6/Q7, préversion ma_journee, Olivier 11/11/2026) :
//  • les véhicules remis au Domaine qui ne sont pas encore dans la zone Domaine → un geste ;
//  • les remises que le robot n'a rattachées à aucune fiche, avec les fiches qui ressemblent.
// Rattacher pose la date de remise sur la fiche, ce qui ARRÊTE le gardiennage Parquet :
// une confirmation dans la page rappelle le véhicule et la date.

import { useCallback, useEffect, useState } from 'react'

interface Cand { id: string; mission_number: number | null; plate: string | null; vehicule: string; vin: string | null; zone: string | null; score: number; raisons: string[] }
interface Ligne { id: string; received_at: string | null; remise_date: string | null; brand: string | null; model: string | null; vin: string | null; vin_tail: string | null; pv_remise_name: string | null; outcome: string; candidats: Cand[] }
interface Hz { id: string; vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; parc_zone_key: string | null; domaine_remise_date: string | null }

const fmt = (v?: string | null) => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—'

export default function RemisesClient() {
  const [data, setData] = useState<{ zone: string; aRattacher: Ligne[]; horsZone: Hz[] } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmer, setConfirmer] = useState<{ ligne: Ligne; cand: Cand } | null>(null)
  const [plaque, setPlaque] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try { const r = await fetch('/api/fourriere/domaine/remises', { cache: 'no-store' }); const j = await r.json(); if (r.ok) setData(j); else setMsg(`⚠ ${j.error || 'Erreur'}`) } catch { setMsg('⚠ Erreur réseau') }
  }, [])
  useEffect(() => { load() }, [load])

  async function ranger() {
    if (!data) return
    setBusy('zone'); let ok = 0; const ko: string[] = []
    for (const v of data.horsZone) {
      try { const r = await fetch(`/api/missions/${v.id}/transfer-parc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone_key: data.zone }) }); if (r.ok) ok++; else ko.push(v.vehicle_plate || '?') } catch { ko.push(v.vehicle_plate || '?') }
    }
    setMsg(`✓ ${ok} véhicule(s) déplacé(s) en zone ${data.zone}${ko.length ? ` · ⚠ échec : ${ko.join(', ')}` : ''}`); setBusy(null); load()
  }
  async function post(body: any, key: string, ok: string) {
    setBusy(key)
    try { const r = await fetch('/api/fourriere/domaine/remises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur'); setMsg(ok); load() }
    catch (e: any) { setMsg(`⚠ ${e.message}`) } finally { setBusy(null) }
  }
  async function chercherPlaque(l: Ligne) {
    const p = (plaque[l.id] || '').trim(); if (!p) return
    const r = await fetch(`/api/fourriere/parc`, { cache: 'no-store' }).then(r => r.json()).catch(() => null)
    const n = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const hits = (r?.vehicles || []).filter((v: any) => n(v.plate).includes(n(p)) || String(v.mission_number ?? '') === p).slice(0, 4)
    if (!hits.length) { setMsg(`Aucun véhicule au parc pour « ${p} »`); return }
    setData(d => d ? { ...d, aRattacher: d.aRattacher.map(x => x.id === l.id ? { ...x, candidats: [...hits.map((v: any) => ({ id: v.id, mission_number: v.mission_number, plate: v.plate, vehicule: [v.brand, v.model].filter(Boolean).join(' '), vin: v.vin, zone: v.zone, score: 0, raisons: ['recherche'] })), ...x.candidats] } : x) } : d)
  }

  if (!data) return <div className="text-center py-12 text-ink-faint text-sm">{msg || 'Chargement…'}</div>
  return (
    <div className="space-y-4">
      {msg && <div className="text-sm px-4 py-2.5 rounded-xl bg-surface-2 border text-ink">{msg}</div>}

      <section className={`rounded-2xl border p-4 space-y-2 ${data.horsZone.length ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-surface text-ink'}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="font-bold flex-1 min-w-[220px]">{data.horsZone.length ? `${data.horsZone.length} véhicule(s) remis au Domaine pas encore en zone ${data.zone}` : `Tous les véhicules remis sont en zone ${data.zone}.`}</p>
          {data.horsZone.length > 0 && <button disabled={busy === 'zone'} onClick={ranger} className="min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold disabled:opacity-50">{busy === 'zone' ? '…' : `Déplacer les ${data.horsZone.length} en zone ${data.zone}`}</button>}
        </div>
        {data.horsZone.length > 0 && <p className="text-xs">{data.horsZone.map(v => `${v.vehicle_plate || '?'} (${v.parc_zone_key || 'sans zone'})`).join(' · ')}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold text-ink">Remises à rattacher · {data.aRattacher.length}</h2>
        <p className="text-sm text-ink-secondary">Le Domaine a signalé ces remises, mais le robot n'a trouvé aucune fiche (ou plusieurs). Choisis la bonne fiche, ou « pas chez nous ». Rattacher pose la date de remise : le gardiennage Parquet s'arrête à cette date.</p>
        {data.aRattacher.length === 0 && <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted">Toutes les remises sont rattachées.</div>}
        {data.aRattacher.map(l => (
          <div key={l.id} className="bg-surface border border-l-[8px] border-l-violet-500 rounded-2xl p-4 space-y-2">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]"><b className="text-ink">{[l.brand, l.model].filter(Boolean).join(' ') || 'Véhicule'}</b><span className="block text-xs text-ink-muted">Remis le {fmt(l.remise_date)} · châssis …{l.vin_tail || String(l.vin || '').slice(-5) || '?'}{l.vin ? ` (${l.vin})` : ''}{l.pv_remise_name ? ` · PV ${l.pv_remise_name}` : ''}{l.outcome === 'ambiguous' ? ' · plusieurs fiches possibles' : ''}</span></div>
              <button disabled={busy === `x${l.id}`} onClick={() => post({ action: 'pas_chez_nous', id: l.id }, `x${l.id}`, '✓ Remise écartée')} className="min-h-[44px] px-4 rounded-xl border bg-surface text-sm font-semibold text-ink disabled:opacity-40">Pas chez nous</button>
            </div>
            {l.candidats.length > 0 ? l.candidats.map(c => (
              <div key={c.id} className="flex items-center gap-2 flex-wrap border-t pt-2">
                <span className="font-mono font-bold text-sm">{c.plate || '—'}</span>
                <span className="text-sm text-ink-secondary flex-1 min-w-[160px]">{c.vehicule || '—'}{c.zone ? ` · zone ${c.zone}` : ''}{c.vin ? ` · …${String(c.vin).slice(-6)}` : ''}<span className="block text-xs text-ink-faint">{c.raisons.join(', ')}</span></span>
                <button onClick={() => setConfirmer({ ligne: l, cand: c })} className="min-h-[44px] px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold">C'est celle-ci</button>
              </div>
            )) : <p className="text-xs text-ink-muted border-t pt-2">Aucune fiche au parc ne ressemble.</p>}
            <div className="flex items-center gap-2 flex-wrap border-t pt-2">
              <input value={plaque[l.id] || ''} onChange={e => setPlaque(p => ({ ...p, [l.id]: e.target.value }))} placeholder="Chercher une plaque ou un n° de fiche" aria-label="Chercher une fiche" className="min-h-[44px] flex-1 min-w-[200px] border rounded-xl px-3 text-sm bg-surface-2 text-ink" />
              <button onClick={() => chercherPlaque(l)} className="min-h-[44px] px-4 rounded-xl border bg-surface text-sm font-semibold text-ink">Chercher</button>
            </div>
          </div>
        ))}
      </section>

      {confirmer && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true">
          <div className="bg-surface text-ink rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-start gap-3"><h2 className="text-lg font-bold flex-1">Rattacher cette remise ?</h2><button onClick={() => setConfirmer(null)} aria-label="Fermer" className="min-h-[44px] min-w-[44px] -m-2 text-ink-muted text-xl">✕</button></div>
            <p className="text-sm text-ink-secondary">Remise du <b>{fmt(confirmer.ligne.remise_date)}</b> ({[confirmer.ligne.brand, confirmer.ligne.model].filter(Boolean).join(' ')}) → fiche <b>{confirmer.cand.plate || '—'}</b> {confirmer.cand.vehicule}. La date de remise est posée sur la fiche : le gardiennage Parquet s'arrête au {fmt(confirmer.ligne.remise_date)} et une étiquette Domaine s'imprime.</p>
            <div className="flex gap-2 justify-end flex-wrap">
              <button onClick={() => setConfirmer(null)} className="min-h-[44px] px-4 rounded-xl border bg-surface text-sm font-semibold">Annuler</button>
              <button disabled={!!busy} onClick={async () => { const c = confirmer; setConfirmer(null); await post({ action: 'rattacher', id: c.ligne.id, mission_id: c.cand.id }, `r${c.ligne.id}`, `✓ Remise rattachée à ${c.cand.plate || 'la fiche'}`) }} className="min-h-[44px] px-4 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-40">Rattacher</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
