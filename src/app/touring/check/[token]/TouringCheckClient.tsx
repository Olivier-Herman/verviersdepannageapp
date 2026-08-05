'use client'
// src/app/touring/check/[token]/TouringCheckClient.tsx
// Tableau public : Touring choisit une réponse par dossier (+ champ libre).

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const RESPONSES = [
  { code: 'already_invoiced',       label: 'Déjà facturé' },
  { code: 'not_covered',            label: 'Contrat 105 non couvert' },
  { code: 'invoice_hors_comex',     label: 'À facturer hors comex' },
  { code: 'deplacement_hors_comex', label: 'Déplacement à facturer hors comex' },
  { code: 'other',                  label: 'Autre…' },
]

const KIND_CLS: Record<string, string> = {
  REM: 'bg-amber-100 text-amber-800',
  DSP: 'bg-sky-100 text-sky-800',
  REL: 'bg-purple-100 text-purple-800',
  DPR: 'bg-rose-100 text-rose-800',
  AUTRE: 'bg-gray-100 text-gray-700',
}
// Couleurs de surlignage des dossiers combinés (parent + fils = même couleur).
const CHAIN_TINTS = [
  'bg-amber-50 border-amber-300',
  'bg-sky-50 border-sky-300',
  'bg-emerald-50 border-emerald-300',
  'bg-purple-50 border-purple-300',
]

function fmtDate(s: string | null) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TouringCheckClient({ token }: { token: string }) {
  const [items, setItems] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Record<string, { code: string; note: string }>>({})
  // statut par dossier : 'saving' | 'saved' | undefined
  const [status, setStatus] = useState<Record<string, 'saving' | 'saved'>>({})
  const timers = useRef<Record<string, any>>({})

  async function load() {
    const r = await fetch(`/api/touring/check/${token}`, { cache: 'no-store' })
    if (!r.ok) { setErr('Lien invalide ou expiré.'); setItems([]); return }
    const j = await r.json()
    setItems(j.items || [])
    const d: Record<string, { code: string; note: string }> = {}
    for (const it of (j.items || [])) {
      if (it.response_code) d[it.id] = { code: it.response_code, note: it.response_note || '' }
    }
    setDraft(d)
  }
  const loadRef = useRef<() => void>(() => {})
  loadRef.current = load
  useEffect(() => { load() }, [])

  // Temps réel : nouveaux dossiers / retraits apparaissent sans rafraîchir.
  // On ne recharge PAS pendant une saisie en cours pour ne pas l'écraser.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    let ch: any
    const safeReload = () => { if (!Object.keys(timers.current).length && !document.activeElement?.matches('input,textarea,select')) loadRef.current() }
    if (url && key) {
      const sb = createClient(url, key)
      ch = sb.channel('touring-check-public')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'touring_check_signal' }, safeReload)
        .subscribe()
    }
    return () => { try { ch?.unsubscribe() } catch {} }
  }, [])

  async function save(id: string, code: string, note: string) {
    if (!code) return
    if (code === 'already_invoiced' && !note.trim()) return  // attend le n° d'accord
    setStatus(s => ({ ...s, [id]: 'saving' }))
    const r = await fetch(`/api/touring/check/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, response_code: code, response_note: note }),
    })
    if (r.ok) {
      setStatus(s => ({ ...s, [id]: 'saved' }))
      setTimeout(() => setStatus(s => { const n = { ...s }; if (n[id] === 'saved') delete n[id]; return n }), 2500)
    } else {
      setStatus(s => { const n = { ...s }; delete n[id]; return n })
      const j = await r.json().catch(() => ({})); alert(j.error || 'Erreur')
    }
  }

  // Choix du menu : enregistre tout de suite si la réponse n'exige pas de texte.
  function onSelect(id: string, code: string) {
    const note = draft[id]?.note || ''
    setDraft(d => ({ ...d, [id]: { code, note } }))
    if (code && code !== 'already_invoiced' && code !== 'other') save(id, code, note)
  }
  // Saisie du texte : enregistre après une courte pause (debounce).
  function onText(id: string, code: string, note: string) {
    setDraft(d => ({ ...d, [id]: { code, note } }))
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => save(id, code, note), 800)
  }

  const pending = (items || []).filter(i => i.status !== 'applied')

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-11 h-11 rounded-2xl bg-[#d6002a] text-white flex items-center justify-center text-xl font-bold">🅣</div>
          <div className="flex-1">
            <h1 className="text-xl font-bold leading-tight">Dossiers Verviers Dépannage à vérifier</h1>
            <p className="text-gray-500 text-sm">Merci d'indiquer, pour chaque dossier, la suite à donner. Vos réponses nous sont transmises directement.</p>
          </div>
          {items && <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#d6002a] text-white whitespace-nowrap">{pending.length} en attente</span>}
        </div>

        {err && <div className="mt-6 bg-white border rounded-2xl p-6 text-center text-gray-500">{err}</div>}
        {items && !err && pending.length === 0 && (
          <div className="mt-6 bg-white border rounded-2xl p-8 text-center text-gray-500">✅ Aucun dossier en attente. Merci !</div>
        )}

        <div className="mt-5 space-y-3">
          {pending.map((it, idx) => {
            const tint = it.is_combined ? CHAIN_TINTS[idx % CHAIN_TINTS.length] : 'bg-white border-gray-200'
            const dr = draft[it.id] || { code: '', note: '' }
            const fiches: any[] = Array.isArray(it.fiches) ? it.fiches : []
            return (
              <div key={it.id} className={`border rounded-2xl overflow-hidden ${tint}`}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-black/5 flex-wrap">
                  <span className="font-mono font-bold text-sm">{it.dossier_number || '—'}</span>
                  <span className="text-xs text-gray-500 tabular-nums">{fmtDate(it.intervention_date)}</span>
                  {it.is_combined && <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">🔗 Dossier combiné</span>}
                </div>
                {fiches.map((f, i) => (
                  <div key={i} className="grid grid-cols-[46px_1fr] sm:grid-cols-[46px_1.3fr_2fr] gap-2 px-4 py-2.5 border-t border-dashed border-black/5 first:border-t-0 items-start">
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded font-mono h-fit ${KIND_CLS[f.kind] || KIND_CLS.AUTRE}`}>{f.kind}</span>
                    <div className="text-sm">
                      <div className="font-mono font-bold tracking-wide">{f.plate || '—'}</div>
                      <div className="text-gray-500 text-xs">{[f.brand, f.model].filter(Boolean).join(' ')}</div>
                    </div>
                    <div className="text-xs text-gray-700 sm:col-auto col-span-2">
                      {f.incident && <div><span className="text-gray-400 uppercase text-[10px] mr-1">Interv.</span>{f.incident}</div>}
                      {f.destination && <div><span className="text-gray-400 uppercase text-[10px] mr-1">Livr.</span><span className="text-[#d6002a] font-bold mx-0.5">→</span>{f.destination}</div>}
                      {f.depannage_label && (
                        <div className="mt-1 font-semibold text-gray-900">{f.depannage_label === 'Appel police' ? '🚓' : '🛠'} {f.depannage_label.startsWith('Siabis') ? 'Siabis' : f.depannage_label} : {f.depannage_htva != null ? `${f.depannage_htva.toFixed(2)} € HT` : '—'}</div>
                      )}
                    </div>
                  </div>
                ))}
                {/* Réponse — enregistrement automatique */}
                <div className="px-4 py-3 bg-black/[0.03] border-t border-black/5">
                  <div className="flex items-center gap-2">
                    <select
                      value={dr.code}
                      onChange={e => onSelect(it.id, e.target.value)}
                      className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:border-[#d6002a] outline-none">
                      <option value="">Choisir une réponse…</option>
                      {RESPONSES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    <span className="text-xs font-semibold whitespace-nowrap w-24 text-right">
                      {status[it.id] === 'saving' ? <span className="text-gray-400">…</span>
                        : status[it.id] === 'saved' ? <span className="text-emerald-600">✓ Enregistré</span>
                        : dr.code && !(dr.code === 'already_invoiced' && !dr.note.trim()) ? <span className="text-gray-400">✓</span>
                        : null}
                    </span>
                  </div>
                  {dr.code === 'already_invoiced' && (
                    <input value={dr.note}
                      onChange={e => onText(it.id, dr.code, e.target.value)}
                      onBlur={() => save(it.id, dr.code, dr.note)}
                      placeholder="N° d'accord Touring (ex. 2024AC002456)"
                      className="mt-2 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:border-[#d6002a] outline-none" />
                  )}
                  {dr.code === 'other' && (
                    <textarea value={dr.note}
                      onChange={e => onText(it.id, dr.code, e.target.value)}
                      onBlur={() => save(it.id, dr.code, dr.note)}
                      placeholder="Précisez…" rows={2}
                      className="mt-2 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#d6002a] outline-none" />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">Vos réponses sont enregistrées au fur et à mesure. Vous pouvez revenir sur ce lien à tout moment.</p>
      </div>
    </div>
  )
}
