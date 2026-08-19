'use client'

// src/components/missions/SaisiePanel.tsx
//
// Panneau des actions spécifiques aux missions Police Saisie, affiché sur la
// fiche bureau (/dispatch/[id]). Olivier 2026-06-13.
//
// Phase 1 : Réquisitoire (annexer un document/note reçu).
// Phase 2 : Levée de saisie (à venir).
// Phase 3 : Cycle temporaire (à venir).
//
// Le document annexé est aussi visible dans la section Remarques de la fiche.

import { useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, CheckCircle2, Unlock, Wrench, Warehouse, Landmark } from 'lucide-react'
import { FOURRIERE_ZONES } from '@/lib/fourriere'
import ScanToFicheButton from '@/components/missions/ScanToFicheButton'

// Jours pleins entre deux dates (end = aujourd'hui si absent)
function joursEntre(start?: string | null, end?: string | null): number {
  if (!start) return 0
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  return Math.max(0, Math.floor((e - s) / (1000 * 60 * 60 * 24)))
}

const todayYmd = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface SaisieMission {
  id:                     string
  source:                 string | null
  status:                 string | null
  parked_at:              string | null
  requisitoire_at:        string | null
  requisitoire_note:      string | null
  requisitoire_doc_path:  string | null
  // Phase 2/3 (présents en BDD, exploités plus tard)
  levee_saisie_at?:       string | null
  levee_saisie_date?:     string | null
  levee_saisie_type?:     string | null
  levee_saisie_note?:     string | null
  police_levee_saisie_ok?: boolean | null
  temp_garage_out_at?:    string | null
  temp_returned_at?:      string | null
  // Remise au Domaine (État)
  domaine_at?:            string | null
  domaine_remise_date?:     string | null
  domaine_enlevement_date?: string | null
  domaine_vente_date?:      string | null
  domaine_note?:          string | null
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return '—' }
}

// Périmètre par source (Olivier 2026-06-14) :
//   - police_saisie : Réquisitoire + Levée + cycle temporaire + Domaine
//   - police_rodeo  : Réquisitoire + Levée (+ cycle temporaire)
//   - police_mg     : Réquisitoire seulement
//   - police_avp    : Réquisitoire + Levée (Olivier 2026-06-17)
const SAISIE_SOURCES = ['police_saisie', 'police_mg', 'police_rodeo', 'police_avp']
// forceSaisie : véhicule placé dans une zone de parc de type "saisie" mais dont
// la source n'est pas une source police (Olivier 2026-06-29). On affiche alors
// le workflow saisie complet (réquisitoire + levée + Domaine) piloté par la zone.
export default function SaisiePanel({ mission, onChanged, forceSaisie = false }: { mission: SaisieMission; onChanged?: () => void; forceSaisie?: boolean }) {
  const src = mission.source || ''
  if (!SAISIE_SOURCES.includes(src) && !forceSaisie) return null
  // Rafraîchit la vue après une action : callback fourni (rafraîchit sur place,
  // ex. fiche véhicule en modale) sinon reload complet (fiche dispatch).
  const done = onChanged ?? (() => { if (typeof window !== 'undefined') window.location.reload() })

  const showLevee   = src === 'police_saisie' || src === 'police_rodeo' || src === 'police_avp' || forceSaisie
  const showDomaine = src === 'police_saisie' || forceSaisie
  const title = src === 'police_saisie' ? 'Saisie' : src === 'police_rodeo' ? 'Rodéo' : src === 'police_avp' ? 'AVP' : forceSaisie ? 'Saisie' : 'Police'

  return (
    <div className="bg-surface border rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🚔</span>
        <h3 className="font-semibold text-ink text-sm">{title}</h3>
      </div>

      <RequisitoireSection mission={mission} onDone={done} />
      {showLevee && <div className="border-t pt-3"><LeveeSaisieSection mission={mission} onDone={done} /></div>}
      {showLevee && mission.levee_saisie_type === 'temporaire' && (
        <div className="border-t pt-3"><TemporaireCycleSection mission={mission} onDone={done} /></div>
      )}
      {showDomaine && <div className="border-t pt-3"><DomaineSection mission={mission} onDone={done} /></div>}
    </div>
  )
}

// ── Réquisitoire ────────────────────────────────────────────────────────────
function RequisitoireSection({ mission, onDone }: { mission: SaisieMission; onDone: () => void }) {
  const [open,    setOpen]    = useState(false)
  const [note,    setNote]    = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [scanned, setScanned] = useState<File[]>([])
  const [ocr, setOcr] = useState<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit() {
    setError(null); setOcr(null)
    const files = fileRef.current?.files
    if ((!files || files.length === 0) && scanned.length === 0 && !note.trim()) {
      setError('Annexe un document ou saisis une note.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      if (note.trim()) fd.append('note', note.trim())
      if (files) for (const f of Array.from(files)) fd.append('files', f)
      for (const f of scanned) fd.append('files', f)
      const r = await fetch(`/api/missions/${mission.id}/requisitoire`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setScanned([])
      // Le document est lu par Claude comme ceux reçus par mail : on montre ce
      // qui a été complété au lieu de le faire dans le dos du dispatcher.
      setOcr(j.ocr || (j.ocr_error ? { failed: j.ocr_error } : null))
      setBusy(false)
      onDone()
    } catch (e: any) {
      setError(e.message); setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {mission.requisitoire_at ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-emerald-800 text-sm font-medium">
            <CheckCircle2 size={16} /> Réquisitoire reçu le {fmtDate(mission.requisitoire_at)}
          </div>
          {mission.requisitoire_note && (
            <p className="text-emerald-900/80 text-xs mt-1 italic">« {mission.requisitoire_note} »</p>
          )}
          <p className="text-ink-muted text-[11px] mt-1">📎 Document consultable dans les Remarques de la fiche.</p>
          <button onClick={() => setOpen(o => !o)} className="text-emerald-700 text-xs underline mt-1">
            Annexer un autre document
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-ink-secondary text-sm flex items-center gap-1.5">
            <FileText size={15} /> Aucun réquisitoire annexé
          </p>
          {!open && (
            <button onClick={() => setOpen(true)}
              className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold">
              📋 Réquisitoire
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="bg-surface-2 border rounded-xl p-3 space-y-2">
          <label className="block">
            <span className="text-ink-secondary text-xs font-medium">Document (PDF, photo…)</span>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf"
              className="block w-full text-xs mt-1 text-ink-secondary file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border file:bg-surface file:text-ink file:text-xs" />
          </label>
          <ScanToFicheButton label="🖨️ Scanner le réquisitoire"
            onScanned={fs => { setScanned(p => [...p, ...fs]); setError(null) }} />
          <ScannedFiles files={scanned} onClear={() => setScanned([])} />
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Note (optionnel) — ex : réquisitoire reçu par mail du Parquet"
            className="w-full bg-surface border border-strong rounded-lg px-2.5 py-2 text-ink text-sm outline-none focus:border-brand" />
          {ocr && <OcrSummary ocr={ocr} />}
          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setError(null); setOcr(null) }} disabled={busy}
              className="flex-1 py-2 bg-surface border text-ink-secondary rounded-lg text-xs font-medium">
              Annuler
            </button>
            <button onClick={submit} disabled={busy}
              className="flex-1 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Annexer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Levée de saisie ──────────────────────────────────────────────────────────
function LeveeSaisieSection({ mission, onDone }: { mission: SaisieMission; onDone: () => void }) {
  const [open,  setOpen]  = useState(false)
  const [type,  setType]  = useState<'definitive' | 'temporaire'>('definitive')
  const [date,  setDate]  = useState(todayYmd())
  const [note,  setNote]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanned, setScanned] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const hasLevee = !!mission.levee_saisie_at
  const leveeTypeLabel = mission.levee_saisie_type === 'temporaire' ? 'temporaire' : 'définitive'

  async function submit() {
    setError(null)
    const files = fileRef.current?.files
    if ((!files || files.length === 0) && scanned.length === 0 && !note.trim()) {
      setError('Annexe un document OU saisis un commentaire (ex : « Levée par téléphone »).')
      return
    }
    if (!date) { setError('Date de levée requise.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('type', type)
      fd.append('date', date)
      if (note.trim()) fd.append('note', note.trim())
      if (files) for (const f of Array.from(files)) fd.append('files', f)
      for (const f of scanned) fd.append('files', f)
      const r = await fetch(`/api/missions/${mission.id}/levee-saisie`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setScanned([])
      onDone()
    } catch (e: any) {
      setError(e.message); setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {hasLevee ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-emerald-800 text-sm font-medium">
            <Unlock size={16} /> Levée de saisie {leveeTypeLabel} — date : {fmtDate(mission.levee_saisie_date)}
          </div>
          {mission.levee_saisie_note && (
            <p className="text-emerald-900/80 text-xs mt-1 italic">« {mission.levee_saisie_note} »</p>
          )}
          <p className="text-ink-muted text-[11px] mt-1">
            🔓 Blocage police levé.{mission.source === 'police_saisie' ? ' Gardiennage « hors période saisie » (20 €/j) compté à partir de la date de levée.' : ''}
          </p>
          {mission.levee_saisie_type === 'temporaire' && !mission.temp_returned_at && (
            <p className="text-amber-700 text-[11px] mt-1">
              ⏳ Levée temporaire — le retour en parc puis la sortie définitive se feront depuis cette fiche.
            </p>
          )}
          <button onClick={() => { setOpen(o => !o); setType('definitive') }} className="text-emerald-700 text-xs underline mt-1">
            Modifier / corriger la levée
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-ink-secondary text-sm flex items-center gap-1.5">
            <Unlock size={15} /> Saisie en cours — levée non enregistrée
          </p>
          {!open && (
            <button onClick={() => setOpen(true)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold">
              🔓 Levée de saisie
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="bg-surface-2 border rounded-xl p-3 space-y-2.5">
          <div>
            <span className="text-ink-secondary text-xs font-medium">Type de levée</span>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {([['definitive', 'Définitive', 'Le client paie, le véhicule part'],
                 ['temporaire', 'Temporaire', 'Passage garagiste puis retour parc']] as const).map(([val, label, hint]) => (
                <button key={val} type="button" onClick={() => setType(val)}
                  className={`p-2 rounded-lg border text-left transition ${
                    type === val ? 'bg-rose-600 text-white border-rose-600' : 'bg-surface hover:bg-surface-hover border-strong text-ink'
                  }`}>
                  <div className="text-xs font-bold">{label}</div>
                  <div className={`text-[10px] ${type === val ? 'text-white/80' : 'text-ink-muted'}`}>{hint}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-ink-secondary text-xs font-medium">Date de levée</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="block w-full mt-1 bg-surface border border-strong rounded-lg px-2.5 py-2 text-ink text-sm outline-none focus:border-rose-500" />
            {mission.source === 'police_saisie' && (
              <span className="text-ink-muted text-[10px]">Influence le calcul du gardiennage (Parquet jusqu'à cette date, puis 20 €/j).</span>
            )}
          </label>

          <label className="block">
            <span className="text-ink-secondary text-xs font-medium">Document de levée (optionnel si commentaire)</span>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf"
              className="block w-full text-xs mt-1 text-ink-secondary file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border file:bg-surface file:text-ink file:text-xs" />
          </label>
          <ScanToFicheButton label="🖨️ Scanner la levée"
            onScanned={fs => { setScanned(p => [...p, ...fs]); setError(null) }} />
          <ScannedFiles files={scanned} onClear={() => setScanned([])} />

          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Commentaire (ex : « Levée de saisie par téléphone »)"
            className="w-full bg-surface border border-strong rounded-lg px-2.5 py-2 text-ink text-sm outline-none focus:border-rose-500" />

          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setError(null) }} disabled={busy}
              className="flex-1 py-2 bg-surface border text-ink-secondary rounded-lg text-xs font-medium">
              Annuler
            </button>
            <button onClick={submit} disabled={busy}
              className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Enregistrer la levée
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Cycle levée temporaire (garagiste -> retour parc) ────────────────────────
function TemporaireCycleSection({ mission, onDone }: { mission: SaisieMission; onDone: () => void }) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickZone, setPickZone] = useState(false)
  const [zone,  setZone]  = useState('')

  const atGarage = !!mission.temp_garage_out_at && !mission.temp_returned_at
  const returned = !!mission.temp_returned_at

  async function call(action: 'garage_out' | 'return', zoneKey?: string) {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${mission.id}/saisie-temp-cycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, zone_key: zoneKey }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onDone()
    } catch (e: any) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <p className="text-ink-secondary text-xs font-semibold uppercase tracking-wide">Cycle levée temporaire</p>

      {returned ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800 text-sm flex items-center gap-2">
          <Warehouse size={16} /> Revenu en parc le {fmtDate(mission.temp_returned_at)} — procéder à la sortie définitive (restitution / encaissement).
        </div>
      ) : atGarage ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
            <Wrench size={16} /> Chez le garagiste depuis le {fmtDate(mission.temp_garage_out_at)}
          </div>
          {!pickZone ? (
            <button onClick={() => setPickZone(true)} disabled={busy}
              className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold">
              ↩ Retour en parc (même dossier)
            </button>
          ) : (
            <div className="space-y-2">
              <span className="text-ink-secondary text-xs font-medium">Zone de ré-entrée</span>
              <div className="grid grid-cols-4 gap-1.5">
                {FOURRIERE_ZONES.map(z => (
                  <button key={z.code} type="button" onClick={() => setZone(z.code)}
                    className={`p-2 rounded-lg border text-center transition ${
                      zone === z.code ? 'bg-brand text-white border-brand' : 'bg-surface hover:bg-surface-hover border-strong text-ink'
                    }`}>
                    <div className="font-display font-bold text-sm">{z.code}</div>
                  </button>
                ))}
              </div>
              {error && <p className="text-critical text-xs">⚠ {error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setPickZone(false); setZone(''); setError(null) }} disabled={busy}
                  className="flex-1 py-2 bg-surface border text-ink-secondary rounded-lg text-xs font-medium">Annuler</button>
                <button onClick={() => zone && call('return', zone)} disabled={busy || !zone}
                  className="flex-1 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-bold disabled:opacity-40">
                  {busy ? <Loader2 size={14} className="inline animate-spin" /> : 'Confirmer le retour'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-ink-muted text-xs">Le véhicule est confié à un garagiste (sort du parc) en attendant la levée définitive.</p>
          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <button onClick={() => call('garage_out')} disabled={busy}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />} Sortie vers garagiste
          </button>
        </div>
      )}
    </div>
  )
}

// ── Remise au Domaine (État) ─────────────────────────────────────────────────
function DomaineSection({ mission, onDone }: { mission: SaisieMission; onDone: () => void }) {
  const [open,   setOpen]   = useState(false)
  const [remise, setRemise] = useState(mission.domaine_remise_date || todayYmd())
  const [enlevement, setEnlevement] = useState(mission.domaine_enlevement_date || '')
  const [vente,  setVente]  = useState(mission.domaine_vente_date || '')
  const [note,   setNote]   = useState('')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const recorded = !!mission.domaine_at
  // Période État = Date IN (remise) → Date OUT (enlèvement) = jours d'écart.
  const joursEtat = recorded && mission.domaine_enlevement_date
    ? joursEntre(mission.domaine_remise_date, mission.domaine_enlevement_date) : 0

  async function submit() {
    setError(null)
    const files = fileRef.current?.files
    if ((!files || files.length === 0) && !note.trim()) {
      setError('Annexe un document OU saisis un commentaire.'); return
    }
    if (!remise) { setError('Date de remise requise.'); return }
    if (enlevement && enlevement < remise) { setError('L\'enlèvement ne peut pas précéder la remise.'); return }
    if (vente && enlevement && vente < enlevement) { setError('La vente ne peut pas précéder l\'enlèvement.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('remise_date', remise)
      if (enlevement) fd.append('enlevement_date', enlevement)
      if (vente) fd.append('vente_date', vente)
      if (note.trim()) fd.append('note', note.trim())
      if (files) for (const f of Array.from(files)) fd.append('files', f)
      const r = await fetch(`/api/missions/${mission.id}/domaine`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onDone()
    } catch (e: any) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="space-y-2">
      {recorded ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
          <div className="flex items-center gap-2 text-indigo-800 text-sm font-medium">
            <Landmark size={16} /> Remis au Domaine — remise : {fmtDate(mission.domaine_remise_date)}
            {mission.domaine_enlevement_date ? ` · enlèvement : ${fmtDate(mission.domaine_enlevement_date)}` : ' · enlèvement : à venir'}
            {mission.domaine_vente_date ? ` · vente : ${fmtDate(mission.domaine_vente_date)}` : ''}
          </div>
          {mission.domaine_note && <p className="text-indigo-900/80 text-xs mt-1 italic">« {mission.domaine_note} »</p>}
          <p className="text-ink-muted text-[11px] mt-1">
            Facturation client/parquet arrêtée à la remise. Gardiennage État (remise → enlèvement inclus) :{' '}
            {mission.domaine_enlevement_date ? `${joursEtat} j` : 'en attente de la date d\'enlèvement'} au tarif parc saisie.
            {mission.domaine_vente_date ? ` Apparaît au trimestre de la vente (${fmtDate(mission.domaine_vente_date)}).` : ' La vente déterminera le trimestre.'}
          </p>
          <button onClick={() => setOpen(o => !o)} className="text-indigo-700 text-xs underline mt-1">
            Modifier (ex : ajouter la date de vente)
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-ink-secondary text-sm flex items-center gap-1.5">
            <Landmark size={15} /> Remise Domaine
          </p>
          {!open && (
            <button onClick={() => setOpen(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">
              🏛 Domaine
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="bg-surface-2 border rounded-xl p-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">Remise *</span>
              <input type="date" value={remise} onChange={e => setRemise(e.target.value)}
                className="block w-full mt-1 bg-surface border border-strong rounded-lg px-2 py-2 text-ink text-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">Enlèvement</span>
              <input type="date" value={enlevement} onChange={e => setEnlevement(e.target.value)}
                className="block w-full mt-1 bg-surface border border-strong rounded-lg px-2 py-2 text-ink text-sm outline-none focus:border-indigo-500" />
            </label>
            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">Vente</span>
              <input type="date" value={vente} onChange={e => setVente(e.target.value)}
                className="block w-full mt-1 bg-surface border border-strong rounded-lg px-2 py-2 text-ink text-sm outline-none focus:border-indigo-500" />
            </label>
          </div>
          <p className="text-ink-muted text-[10px]">Remise = fin facturation client/parquet. Gardiennage État = remise → <b>enlèvement</b> (inclus). La <b>vente</b> détermine le trimestre.</p>

          <label className="block">
            <span className="text-ink-secondary text-xs font-medium">Document (optionnel si commentaire)</span>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf"
              className="block w-full text-xs mt-1 text-ink-secondary file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border file:bg-surface file:text-ink file:text-xs" />
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Commentaire (ex : décision police remise Domaine du …)"
            className="w-full bg-surface border border-strong rounded-lg px-2.5 py-2 text-ink text-sm outline-none focus:border-indigo-500" />

          {error && <p className="text-critical text-xs">⚠ {error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setOpen(false); setError(null) }} disabled={busy}
              className="flex-1 py-2 bg-surface border text-ink-secondary rounded-lg text-xs font-medium">Annuler</button>
            <button onClick={submit} disabled={busy}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />} Enregistrer la remise
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pages scannées en attente d'envoi ───────────────────────────────────────
// Le scan ne part pas tout seul : il rejoint le formulaire, et c'est « Annexer »
// qui envoie. On voit donc toujours ce qu'on s'apprête à joindre.
function ScannedFiles({ files, onClear }: { files: File[]; onClear: () => void }) {
  if (!files.length) return null
  const ko = Math.round(files.reduce((n, f) => n + f.size, 0) / 1024)
  return (
    <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
      <span className="text-emerald-800 text-xs font-medium">
        🖨️ {files.length} page{files.length > 1 ? 's' : ''} scannée{files.length > 1 ? 's' : ''} ({ko} Ko) — prête{files.length > 1 ? 's' : ''} à annexer
      </span>
      <button type="button" onClick={onClear} className="text-emerald-700 text-[11px] underline shrink-0">Retirer</button>
    </div>
  )
}

// ── Ce que la lecture automatique a complété ────────────────────────────────
// Le document scanné passe par le même moteur que les réquisitoires reçus par
// mail. On affiche ce qui a été repris : une fiche qui se complète toute seule
// sans le dire, personne ne lui fait confiance.
function OcrSummary({ ocr }: { ocr: any }) {
  if (ocr.failed) {
    return (
      <p className="text-amber-700 text-xs">
        📖 Document annexé, mais la lecture automatique a échoué ({String(ocr.failed).slice(0, 80)}) — complète la fiche à la main.
      </p>
    )
  }
  if (ocr.misfiled) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs">
        <p className="text-amber-900 font-medium">📖 Ce document ressemble à une levée de saisie, pas à un réquisitoire.</p>
        <p className="text-amber-800 mt-0.5">
          Il est annexé, mais la fiche n&apos;a pas été complétée. Utilise le bouton <strong>🔓 Levée de saisie</strong>.
        </p>
      </div>
    )
  }
  const bits = [
    ocr.pv_number && `PV ${ocr.pv_number}`,
    ocr.plaque    && `plaque ${ocr.plaque}`,
    ocr.vin       && `VIN ${ocr.vin}`,
    ocr.date      && `date ${ocr.date.split('-').reverse().join('/')}${ocr.heure ? ` ${ocr.heure}` : ''}`,
    ocr.autorite,
  ].filter(Boolean)
  if (!bits.length) return <p className="text-ink-muted text-xs">📖 Document lu, rien d&apos;exploitable à reprendre.</p>
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs">
      <p className="text-emerald-900 font-medium">📖 Lu automatiquement — fiche complétée</p>
      <p className="text-emerald-800 mt-0.5">{bits.join(' · ')}</p>
      {ocr.date_adapted && <p className="text-emerald-700 mt-0.5">Date d&apos;intervention alignée sur le réquisitoire.</p>}
    </div>
  )
}
