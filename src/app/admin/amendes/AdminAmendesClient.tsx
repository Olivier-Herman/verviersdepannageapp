'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useRouter }          from 'next/navigation'
import Link                   from 'next/link'
import AppShell               from '@/components/layout/AppShell'
import { formatEur }          from '@/lib/format'

interface Fine {
  id:                       string
  photo_url:                string
  infraction_date:          string
  infraction_place:         string | null
  infraction_type:          string | null
  infraction_ref:           string | null
  amount:                   number
  plate:                    string
  driver_id:                string | null
  driver_match_method:      string | null
  driver_match_confidence:  string | null
  mission_id:               string | null
  status:                   string
  notes:                    string | null
  purchase_email_sent:      boolean
  purchase_email_sent_at:   string | null
  created_at:               string
  driver:                   { id: string; name: string; email: string } | null
  created_by_user:          { name: string } | null
  mission:                  { id: string; mission_number: number | null; external_id: string | null; dossier_number: string | null } | null
}

interface Driver { id: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  speeding:  '🚓 Excès vitesse',
  parking:   '🅿️ Stationnement',
  red_light: '🚦 Feu rouge',
  priority:  '⚠️ Priorité',
  phone:     '📱 Téléphone',
  belt:      '🔓 Ceinture',
  other:     '📝 Autre',
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:          { label: '⏳ En attente',         color: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  sent_to_purchase: { label: '📧 Envoyée compta',     color: 'bg-blue-500/15 text-blue-700 border-blue-500/30' },
  paid:             { label: '✅ Payée',              color: 'bg-green-500/15 text-green-700 border-green-500/30' },
  disputed:         { label: '⚖️ Contestée',          color: 'bg-purple-500/15 text-purple-700 border-purple-500/30' },
  cancelled:        { label: '❌ Annulée',             color: 'bg-gray-500/15 text-gray-700 border-gray-500/30' },
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// UTC → "YYYY-MM-DDTHH:mm" pour un input datetime-local (heure locale du navigateur = BE).
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const FINE_TYPE_OPTIONS: [string, string][] = [
  ['', '— Type —'], ['speeding', '🚓 Excès de vitesse'], ['parking', '🅿️ Stationnement'],
  ['red_light', '🚦 Feu rouge'], ['priority', '⚠️ Priorité'], ['phone', '📱 Téléphone'],
  ['belt', '🔓 Ceinture'], ['other', '📝 Autre'],
]

export default function AdminAmendesClient({ fines, drivers, userRole, userName, userModules }: {
  fines:       Fine[]
  drivers:     Driver[]
  userRole:    string
  userName:    string
  userModules: string[]
}) {
  const [driverFilter, setDriverFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [yearFilter,   setYearFilter]   = useState<string>('all')

  // Copie locale (mise à jour lors d'une attribution manuelle de chauffeur).
  const [rows, setRows]       = useState<Fine[]>(fines)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editId, setEditId]     = useState<string | null>(null)

  async function assignDriver(fineId: string, driverId: string) {
    setSavingId(fineId)
    try {
      const res = await fetch(`/api/fines/${fineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: driverId || null }),
      })
      const j = await res.json()
      if (res.ok) {
        setRows(rs => rs.map(f => f.id === fineId
          ? { ...f, driver_id: j.driver_id, driver_match_method: j.driver_id ? 'manual' : 'none',
              driver: j.driver_id ? { id: j.driver_id, name: j.driver_name, email: '' } : null }
          : f))
      } else {
        alert(j.error || 'Échec de l’attribution')
      }
    } finally { setSavingId(null) }
  }

  const router = useRouter()
  useEffect(() => { setRows(fines) }, [fines])

  // ── Import par lot (glisser-déposer de scans de PV) ────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string>('')

  async function uploadFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList).filter(f => f.type.includes('pdf') || f.type.startsWith('image/'))
    if (arr.length === 0) { setImportMsg('⚠ Dépose des PDF ou images de PV.'); return }
    setImporting(true); setImportMsg(`Lecture de ${arr.length} PV…`)
    try {
      const fd = new FormData()
      arr.forEach(f => fd.append('files', f))
      const res = await fetch('/api/fines/batch', { method: 'POST', body: fd })
      const j = await res.json()
      if (res.ok) {
        const withAmount = j.created.filter((c: any) => c.amount != null).length
        setImportMsg(`✅ ${j.created.length} PV importé(s) en brouillon (${withAmount} avec montant lu)${j.errors?.length ? ` · ${j.errors.length} échec(s)` : ''}${j.skipped ? ` · ${j.skipped} en attente (relance)` : ''}`)
        router.refresh()
      } else setImportMsg(`⚠ ${j.error || 'Échec import'}`)
    } catch { setImportMsg('⚠ Erreur réseau') }
    setImporting(false)
  }

  // ── Édition du montant (complète la fiche) + envoi aux achats ──────────────
  async function saveAmount(fineId: string, value: string) {
    const amount = value.trim() === '' ? null : Number(value.replace(',', '.'))
    setSavingId(fineId)
    try {
      const res = await fetch(`/api/fines/${fineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const j = await res.json()
      if (res.ok) setRows(rs => rs.map(f => f.id === fineId ? { ...f, amount: (amount as any) } : f))
      else alert(j.error || 'Montant invalide')
    } finally { setSavingId(null) }
  }

  // Édition des données saisies par le système (OCR) : plaque, date, type, lieu, n° PV.
  async function patchFine(fineId: string, body: Record<string, any>) {
    setSavingId(fineId)
    try {
      const res = await fetch(`/api/fines/${fineId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (res.ok) { setEditId(null); router.refresh() }
      else alert(j.error || 'Erreur')
    } finally { setSavingId(null) }
  }

  async function sendToPurchase(fineId: string) {
    if (!confirm('Envoyer cette amende aux achats ?')) return
    setSavingId(fineId)
    try {
      const res = await fetch(`/api/fines/${fineId}/send-to-purchase`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) setRows(rs => rs.map(f => f.id === fineId ? { ...f, status: 'sent_to_purchase', purchase_email_sent: true } : f))
      else alert(j.error || 'Échec de l’envoi')
    } finally { setSavingId(null) }
  }

  const years = useMemo(() => {
    const set = new Set<number>()
    rows.forEach(f => set.add(new Date(f.infraction_date).getFullYear()))
    return Array.from(set).sort((a, b) => b - a)
  }, [rows])

  const filtered = useMemo(() => rows.filter(f => {
    if (driverFilter !== 'all') {
      if (driverFilter === 'unknown') {
        if (f.driver_id) return false
      } else if (f.driver_id !== driverFilter) return false
    }
    if (statusFilter !== 'all' && f.status !== statusFilter) return false
    if (yearFilter !== 'all'   && String(new Date(f.infraction_date).getFullYear()) !== yearFilter) return false
    return true
  }), [rows, driverFilter, statusFilter, yearFilter])

  // Stats : total par chauffeur (sur le filtre courant sans driver)
  const statsByDriver = useMemo(() => {
    const filteredSansDriver = rows.filter(f => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false
      if (yearFilter !== 'all'   && String(new Date(f.infraction_date).getFullYear()) !== yearFilter) return false
      return true
    })
    const map = new Map<string, { name: string; count: number; total: number }>()
    for (const f of filteredSansDriver) {
      const key  = f.driver_id || 'unknown'
      const name = f.driver?.name || '— non identifié —'
      const cur  = map.get(key) || { name, count: 0, total: 0 }
      cur.count++
      cur.total += Number(f.amount) || 0
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [rows, statusFilter, yearFilter])

  const grandTotal      = filtered.reduce((s, f) => s + Number(f.amount), 0)
  const grandCount      = filtered.length
  const grandUnknown    = filtered.filter(f => !f.driver_id).length

  return (
    <AppShell title="Amendes — Administration" userRole={userRole} userName={userName} userModules={userModules}>
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-4">
        {/* Header + actions */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-ink font-bold text-xl">⚠️ Amendes / PV</h1>
            <p className="text-ink-muted text-sm mt-0.5">{grandCount} amende(s) — Total {formatEur(grandTotal)}{grandUnknown > 0 && ` · ${grandUnknown} sans chauffeur`}</p>
          </div>
          <Link href="/amendes"
            className="px-4 py-2 bg-brand text-ink rounded-xl text-sm font-semibold whitespace-nowrap">
            + Saisir un PV
          </Link>
        </div>

        {/* Import par lot (glisser-déposer) */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
          onClick={() => !importing && fileRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition ${dragOver ? 'border-brand bg-brand/10' : 'border-zinc-400 bg-surface hover:bg-surface-2'}`}>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple className="hidden"
            onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
          <p className="text-ink font-semibold text-sm">📎 Glisse tes scans de PV ici (un fichier = un PV)</p>
          <p className="text-ink-muted text-xs mt-1">PDF ou images · plusieurs à la fois · lecture auto (plaque, date, montant…) → brouillons à compléter</p>
          {importing && <p className="text-brand text-xs mt-2">⏳ {importMsg}</p>}
        </div>
        {!importing && importMsg && <div className="text-sm bg-surface-2 border rounded-xl px-4 py-2 text-ink">{importMsg}</div>}

        {/* Filtres */}
        <div className="bg-surface border rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Chauffeur</label>
            <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Tous</option>
              <option value="unknown">— Non identifié —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Statut</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Tous</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-ink-muted text-xs uppercase tracking-wider font-medium mb-1.5">Année</label>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm">
              <option value="all">Toutes</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Stats par chauffeur */}
        {statsByDriver.length > 0 && (
          <div className="bg-surface border rounded-2xl p-4">
            <h2 className="text-ink-muted text-xs uppercase tracking-wider font-medium mb-3">
              💰 Coût par chauffeur (filtres appliqués hors chauffeur)
            </h2>
            <div className="space-y-1.5">
              {statsByDriver.map(s => (
                <button key={s.id}
                  onClick={() => setDriverFilter(s.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    driverFilter === s.id ? 'bg-brand/15 border border-brand/30' : 'bg-surface-2 border hover:border-zinc-600'
                  }`}>
                  <span className={`flex-1 text-left ${s.id === 'unknown' ? 'text-ink-faint italic' : 'text-ink font-medium'}`}>
                    {s.name}
                  </span>
                  <span className="text-ink-muted text-xs">{s.count} amende{s.count > 1 ? 's' : ''}</span>
                  <span className="text-ink font-bold tabular-nums w-20 text-right">{formatEur(s.total)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Liste des amendes */}
        {filtered.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center">
            <p className="text-ink-muted text-sm">Aucune amende avec ces filtres.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(f => {
              const status = STATUS_LABEL[f.status] || { label: f.status, color: 'bg-gray-500/15 text-gray-700 border-gray-500/30' }
              const isAuto = f.driver_match_method === 'auto'
              return (
                <li key={f.id} className="bg-surface border rounded-2xl p-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                  <a href={f.photo_url} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 w-16 h-16 bg-surface-2 border rounded-xl flex items-center justify-center text-xl hover:border-brand">
                    📄
                  </a>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-ink font-semibold text-sm">{f.plate}</span>
                      <span className="text-ink-muted text-xs">·</span>
                      <span className="text-ink-secondary text-xs">{fmtDate(f.infraction_date)}</span>
                      {f.infraction_type && <span className="text-ink-muted text-xs">· {TYPE_LABEL[f.infraction_type] || f.infraction_type}</span>}
                    </div>
                    {f.infraction_place && <p className="text-ink-muted text-xs truncate">{f.infraction_place}</p>}
                    <p className="text-ink-muted text-xs mt-0.5">
                      {f.driver
                        ? <>Chauffeur : <span className="text-ink font-medium">{f.driver.name}</span> {isAuto && <span className="text-ink-faint">· auto</span>}</>
                        : <span className="text-amber-700 italic">⚠️ Chauffeur non identifié</span>}
                      {f.mission && (
                        <> · <Link href={`/dispatch/${f.mission.id}`} className="text-info hover:underline">
                          Mission {f.mission.mission_number != null ? `#${f.mission.mission_number}` : (f.mission.external_id || f.mission.dossier_number)}
                        </Link></>
                      )}
                    </p>
                    {f.infraction_ref && <p className="text-ink-faint text-xs font-mono mt-0.5">N° {f.infraction_ref}</p>}
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-ink-faint text-xs">Attribuer :</span>
                      <select
                        value={f.driver_id || ''}
                        disabled={savingId === f.id}
                        onChange={e => assignDriver(f.id, e.target.value)}
                        className="bg-surface-2 border rounded-md px-2 py-1 text-xs text-ink max-w-[200px] disabled:opacity-50">
                        <option value="">— Non identifié —</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      {savingId === f.id && <span className="text-ink-faint text-xs">…</span>}
                    </div>
                    <button onClick={() => setEditId(editId === f.id ? null : f.id)}
                      className="mt-1.5 text-xs text-brand hover:underline">
                      {editId === f.id ? '✕ Fermer l’édition' : '✏️ Modifier les infos'}
                    </button>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="0.01" min="0"
                        defaultValue={f.amount != null ? String(f.amount) : ''}
                        placeholder="montant"
                        disabled={savingId === f.id || f.status === 'sent_to_purchase'}
                        onBlur={e => { const v = e.target.value; if (v !== (f.amount != null ? String(f.amount) : '')) saveAmount(f.id, v) }}
                        className="w-24 bg-surface-2 border rounded-md px-2 py-1 text-sm text-ink text-right tabular-nums disabled:opacity-60" />
                      <span className="text-ink-muted text-xs">€</span>
                    </div>
                    {f.amount == null && <span className="text-amber-700 text-[11px] italic">à compléter</span>}
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${status.color}`}>
                      {status.label}
                    </span>
                    {f.status !== 'sent_to_purchase' && f.amount != null && Number(f.amount) > 0 && (
                      <button onClick={() => sendToPurchase(f.id)} disabled={savingId === f.id}
                        className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50">
                        → Envoyer aux achats
                      </button>
                    )}
                  </div>
                  </div>

                  {editId === f.id && (
                    <FineEditForm fine={f} saving={savingId === f.id} onSave={patchFine} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}

// Panneau d'édition des données saisies par le système (OCR) : plaque, date,
// type, lieu, n° PV. La date est en heure locale (navigateur = BE) → convertie
// côté serveur (parseTowsoftDateUTC).
function FineEditForm({ fine, saving, onSave }: {
  fine:   Fine
  saving: boolean
  onSave: (id: string, body: Record<string, any>) => void
}) {
  const [plate, setPlate] = useState(fine.plate || '')
  const [date,  setDate]  = useState(toLocalInput(fine.infraction_date))
  const [type,  setType]  = useState(fine.infraction_type || '')
  const [place, setPlace] = useState(fine.infraction_place || '')
  const [ref,   setRef]   = useState(fine.infraction_ref || '')
  const inputCls = 'mt-1 w-full bg-surface-2 border rounded-md px-2 py-1.5 text-sm text-ink'
  return (
    <div className="mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="text-xs text-ink-muted">Plaque
        <input value={plate} onChange={e => setPlate(e.target.value)} className={`${inputCls} uppercase`} />
      </label>
      <label className="text-xs text-ink-muted">Date &amp; heure (locale)
        <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
      </label>
      <label className="text-xs text-ink-muted">Type
        <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
          {FINE_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-muted">N° de PV
        <input value={ref} onChange={e => setRef(e.target.value)} className={inputCls} />
      </label>
      <label className="text-xs text-ink-muted sm:col-span-2">Lieu
        <input value={place} onChange={e => setPlace(e.target.value)} className={inputCls} />
      </label>
      <div className="sm:col-span-2">
        <button disabled={saving}
          onClick={() => onSave(fine.id, { plate, infraction_date: date, infraction_type: type, infraction_place: place, infraction_ref: ref })}
          className="px-3 py-1.5 bg-brand text-white rounded-lg text-sm font-semibold disabled:opacity-50">
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
