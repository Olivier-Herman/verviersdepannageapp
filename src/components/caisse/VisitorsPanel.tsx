'use client'

// Registre des VISITES d'un véhicule en parc, affiché sur la fiche.
//   • Bouton « Visiteur » → écran comptoir (lecture carte + motifs) ;
//   • Ajout MANUEL (visiteur qui refuse la lecture eID) ;
//   • Tableau des visites (date, identité, motifs, bureau, source) + suppression.
// Motifs & bureaux d'expertise viennent du serveur (paramétrables /admin/visites).

import { useCallback, useEffect, useState } from 'react'
import VisitorButton from './VisitorButton'

interface Visitor {
  id: string
  visited_at: string
  last_name: string | null
  first_name: string | null
  birth_date: string | null
  motifs: string[]
  expert_bureau: string | null
  note: string | null
  source: 'eid' | 'manual'
}
interface Motif { label: string; is_expert: boolean }

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export default function VisitorsPanel({
  missionId, plate, screenKey = 'facturation',
}: {
  missionId: string
  plate?: string | null
  screenKey?: string
}) {
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [motifs, setMotifs]     = useState<Motif[]>([])
  const [bureaux, setBureaux]   = useState<string[]>([])
  const [loading, setLoading]   = useState(true)
  const [showManual, setShowManual] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/missions/${missionId}/visitors`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'load')
      setVisitors(j.visitors || []); setMotifs(j.motifs || []); setBureaux(j.bureaux || [])
    } catch { /* silencieux */ } finally { setLoading(false) }
  }, [missionId])

  useEffect(() => { load() }, [load])

  const remove = async (vid: string) => {
    if (!window.confirm('Supprimer cette visite ?')) return
    await fetch(`/api/missions/${missionId}/visitors?vid=${vid}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="w-full bg-surface-2 border border-app rounded-2xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          👥 Visites
          {visitors.length > 0 && <span className="text-xs font-normal text-ink-muted">({visitors.length})</span>}
        </h3>
        <button onClick={() => setShowManual(v => !v)}
          className="text-xs text-brand hover:underline">
          {showManual ? 'Fermer' : '＋ Ajout manuel'}
        </button>
      </div>

      {/* Enregistrement via l'écran comptoir */}
      <VisitorButton missionId={missionId} plate={plate} screenKey={screenKey} onDone={load} />

      {/* Ajout manuel (refus de lecture eID) */}
      {showManual && (
        <ManualVisitorForm
          motifs={motifs} bureaux={bureaux}
          onSaved={() => { setShowManual(false); load() }}
          missionId={missionId}
        />
      )}

      {/* Liste des visites */}
      {loading ? (
        <p className="text-xs text-ink-muted">Chargement…</p>
      ) : visitors.length === 0 ? (
        <p className="text-xs text-ink-muted italic">Aucune visite enregistrée.</p>
      ) : (
        <ul className="space-y-2">
          {visitors.map(v => (
            <li key={v.id} className="bg-surface border border-app rounded-xl p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate">
                    {[v.first_name, v.last_name].filter(Boolean).join(' ') || '—'}
                    {v.birth_date && <span className="text-ink-muted font-normal text-xs"> · né(e) {v.birth_date}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {v.motifs.map((m, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-info-soft text-info font-medium">{m}</span>
                    ))}
                    {v.expert_bureau && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">🔎 {v.expert_bureau}</span>
                    )}
                  </div>
                  {v.note && <div className="text-xs text-ink-muted mt-1 italic">{v.note}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] text-ink-muted whitespace-nowrap">{fmt(v.visited_at)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.source === 'eid' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {v.source === 'eid' ? '🪪 carte' : '✍️ manuel'}
                  </span>
                  <button onClick={() => remove(v.id)} className="text-[11px] text-ink-muted hover:text-critical">Suppr.</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Formulaire d'ajout manuel ───────────────────────────────────────────────
function ManualVisitorForm({
  motifs, bureaux, missionId, onSaved,
}: {
  motifs: Motif[]; bureaux: string[]; missionId: string; onSaved: () => void
}) {
  const [lastName, setLastName]   = useState('')
  const [firstName, setFirstName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sel, setSel]             = useState<string[]>([])
  const [motifOther, setMotifOther] = useState('')
  const [bureau, setBureau]       = useState('')
  const [bureauOther, setBureauOther] = useState('')
  const [note, setNote]           = useState('')
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  const expertSelected = motifs.some(m => m.is_expert && sel.includes(m.label))
  const toggle = (l: string) => setSel(p => p.includes(l) ? p.filter(x => x !== l) : [...p, l])

  const save = async () => {
    setErr(null)
    const allMotifs = [...sel]; if (motifOther.trim()) allMotifs.push(motifOther.trim())
    if (!lastName.trim() && !firstName.trim()) { setErr('Nom ou prénom requis.'); return }
    if (!allMotifs.length) { setErr('Au moins un motif.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/visitors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_name: lastName, first_name: firstName, birth_date: birthDate.trim() || null,
          motifs: allMotifs,
          expert_bureau: (bureau === '__other__' ? bureauOther.trim() : bureau) || null,
          note: note.trim() || null, source: 'manual',
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'save')
      onSaved()
    } catch (e: any) { setErr(e?.message || 'Erreur'); setBusy(false) }
  }

  const inputCls = 'w-full px-2 py-1.5 bg-surface border border-app rounded-lg text-sm text-ink'
  return (
    <div className="bg-surface border border-app rounded-xl p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Prénom" value={firstName} onChange={e => setFirstName(e.target.value)} />
        <input className={inputCls} placeholder="Nom" value={lastName} onChange={e => setLastName(e.target.value)} />
      </div>
      <input className={inputCls} placeholder="Date de naissance (facultatif)" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        {motifs.map(m => (
          <button key={m.label} type="button" onClick={() => toggle(m.label)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${sel.includes(m.label) ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink-secondary border-app'}`}>
            {sel.includes(m.label) ? '✓ ' : ''}{m.label}
          </button>
        ))}
      </div>
      <input className={inputCls} placeholder="Autre motif (facultatif)" value={motifOther} onChange={e => setMotifOther(e.target.value)} />
      {expertSelected && (
        <div className="space-y-1.5">
          <div className="text-xs text-ink-muted font-medium">Bureau d'expertise</div>
          <div className="flex flex-wrap gap-1.5">
            {bureaux.map(b => (
              <button key={b} type="button" onClick={() => { setBureau(b); setBureauOther('') }}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${bureau === b ? 'bg-amber-500 text-white border-amber-500' : 'bg-surface-2 text-ink-secondary border-app'}`}>
                {bureau === b ? '✓ ' : ''}{b}
              </button>
            ))}
            <button type="button" onClick={() => setBureau('__other__')}
              className={`text-xs px-2.5 py-1 rounded-full border font-medium ${bureau === '__other__' ? 'bg-amber-500 text-white border-amber-500' : 'bg-surface-2 text-ink-secondary border-app'}`}>
              Autre
            </button>
          </div>
          {bureau === '__other__' && (
            <input className={inputCls} placeholder="Nom du bureau / de l'expert" value={bureauOther} onChange={e => setBureauOther(e.target.value)} />
          )}
        </div>
      )}
      <input className={inputCls} placeholder="Remarque (facultatif)" value={note} onChange={e => setNote(e.target.value)} />
      {err && <p className="text-critical text-xs">⚠ {err}</p>}
      <button type="button" onClick={save} disabled={busy}
        className="w-full py-2 bg-brand hover:opacity-90 text-white rounded-xl text-sm font-semibold disabled:opacity-60">
        {busy ? 'Enregistrement…' : 'Enregistrer la visite'}
      </button>
    </div>
  )
}
