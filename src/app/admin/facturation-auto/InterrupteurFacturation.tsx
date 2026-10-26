'use client'
// Interrupteur général de la facturation automatique — visible et utilisable par Olivier seul (la page ne le rend que
// pour ses comptes, l'API refuse et note au journal toute autre tentative). Olivier 26/10/2026.

import { useEffect, useState } from 'react'

interface Ligne { id: number; action: 'suspension' | 'reprise' | 'refus'; par_nom: string | null; motif: string | null; at: string }
interface Etat { visible: boolean; enMarche?: boolean; depuis?: string | null; par?: string | null; motif?: string | null; journal?: Ligne[] }

const quand = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

export default function InterrupteurFacturation() {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [confirmer, setConfirmer] = useState<null | boolean>(null)   // état visé
  const [motif, setMotif] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [voirJournal, setVoirJournal] = useState(false)

  const load = async () => {
    const r = await fetch('/api/admin/facturation-auto', { cache: 'no-store' }).then(x => x.json()).catch(() => null)
    setEtat(r && !r.error ? r : { visible: false })
  }
  useEffect(() => { load() }, [])

  async function basculer() {
    if (confirmer == null) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/facturation-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enMarche: confirmer, motif: motif.trim() || null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Échec'); return }
      setConfirmer(null); setMotif(''); await load()
    } catch { setErr('Erreur réseau') } finally { setBusy(false) }
  }

  if (!etat) return <div className="bg-surface border rounded-2xl p-4 text-ink-muted text-sm">Chargement de l’interrupteur…</div>
  if (!etat.visible) return null
  const on = !!etat.enMarche

  return (
    <>
      {!on && (
        <div className="rounded-2xl border-2 border-red-500 bg-red-50 px-4 py-3 text-red-900">
          <p className="font-bold">⏸️ Facturation automatique suspendue{etat.depuis ? ` depuis le ${quand(etat.depuis)}` : ''}{etat.par ? ` (${etat.par})` : ''}</p>
          <p className="text-sm text-red-800 mt-0.5">Aucune facture, clôture Allianz ni validation Touring ne part toute seule. À la reprise, tout ce qui a été clôturé entre-temps est facturé au premier passage.{etat.motif ? ` Motif : ${etat.motif}` : ''}</p>
        </div>
      )}

      <div className="bg-surface border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink text-sm font-semibold">Facturation automatique : <span className={on ? 'text-emerald-700' : 'text-red-700'}>{on ? 'en marche' : 'suspendue'}</span></p>
            <p className="text-ink-muted text-xs mt-0.5">Interrupteur général, au-dessus des règles par source. Toi seul le vois et peux le basculer.</p>
          </div>
          <button type="button" onClick={() => { setErr(null); setMotif(''); setConfirmer(!on) }} disabled={busy}
            className={`shrink-0 min-h-[44px] px-4 rounded-xl font-bold text-sm text-white disabled:opacity-50 ${on ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {on ? '⏸️ Suspendre' : '▶️ Relancer'}
          </button>
        </div>
        <button type="button" onClick={() => setVoirJournal(v => !v)} className="text-xs font-semibold text-ink-secondary underline min-h-[32px]">
          {voirJournal ? 'Masquer le journal' : `Voir le journal${etat.journal?.length ? ` (${etat.journal.length})` : ''}`}
        </button>
        {voirJournal && (
          <ul className="border-t pt-2 space-y-1.5">
            {(etat.journal || []).length === 0 && <li className="text-ink-muted text-xs">Aucune bascule pour l’instant.</li>}
            {(etat.journal || []).map(l => (
              <li key={l.id} className="text-xs text-ink-secondary">
                <span className="tabular-nums text-ink-muted">{quand(l.at)}</span>{' · '}
                <b className={l.action === 'refus' ? 'text-amber-700' : l.action === 'suspension' ? 'text-red-700' : 'text-emerald-700'}>
                  {l.action === 'suspension' ? 'Suspendue' : l.action === 'reprise' ? 'Relancée' : 'Tentative refusée'}
                </b>{l.par_nom ? ` par ${l.par_nom}` : ''}{l.motif && l.action !== 'refus' ? ` — ${l.motif}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmer != null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <p className="font-bold text-slate-900">{confirmer ? '▶️ Relancer la facturation automatique ?' : '⏸️ Suspendre la facturation automatique ?'}</p>
              <button type="button" onClick={() => setConfirmer(null)} className="w-11 h-11 flex items-center justify-center text-slate-500 text-2xl" aria-label="Fermer">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                {confirmer
                  ? 'Tout repart au prochain passage : les fiches clôturées pendant la suspension seront facturées, sans doublon.'
                  : 'Plus aucune facture, clôture Allianz ni validation Touring ne partira toute seule, jusqu’à ce que tu relances. Les règles par source ne changent pas.'}
              </p>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Motif (facultatif)</span>
                <input value={motif} onChange={e => setMotif(e.target.value)} maxLength={300} placeholder={confirmer ? 'Ex. contrôle terminé' : 'Ex. contrôle des tarifs'}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900" />
              </label>
              {err && <p className="text-sm font-semibold text-red-700">⚠ {err}</p>}
            </div>
            <div className="px-5 py-4 border-t bg-slate-50 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmer(null)} disabled={busy} className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold">Annuler</button>
              <button type="button" onClick={basculer} disabled={busy}
                className={`min-h-[44px] px-4 rounded-xl text-white font-bold disabled:opacity-50 ${confirmer ? 'bg-emerald-600' : 'bg-red-600'}`}>
                {busy ? '⏳' : confirmer ? 'Relancer' : 'Suspendre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
