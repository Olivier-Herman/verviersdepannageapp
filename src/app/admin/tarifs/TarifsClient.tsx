'use client'

import { useEffect, useState, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'
import RulesPanel from './RulesPanel'

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string
  userId?:     string
  userModules: string[]
}

interface Tariff {
  id:                    string
  source:                string
  mission_type:          string
  unit_price:            number | null
  km_inclus:             number
  km_price:              number | null
  km_basis:              'charged' | 'total'
  parc_day_price:        number | null
  surcharge_night_pct:   number
  surcharge_we_pct:      number
  surcharge_holiday_pct: number
  conditions:            string | null
  is_autofac:            boolean
  effective_from:        string
  effective_to:          string | null
  source_document_path:  string | null
  source_document_name:  string | null
  notes:                 string | null
  created_at:            string
  // Mode brackets (IPA: AXA + Ardenne Prevoyante) | lines (lignes pre-configurees)
  pricing_mode:          'forfait' | 'brackets' | 'lines'
  beyond_max_km:         number | null
  beyond_max_step_km:    number | null
  beyond_max_step_price: number | null
}

interface Bracket {
  id:            number
  from_km:       number
  to_km:         number
  price_normal:  number
  price_majore:  number
  effective_from: string
  effective_to:  string | null
}

type LineKind = 'SERV-PEC' | 'SERV-KM' | 'SERV-PARC' | 'SERV-MAJ' | 'SERV-DIV'

interface TariffLine {
  id:               number
  position:         number
  kind:             LineKind
  name:             string
  default_qty:      number | null
  default_price:    number | null
  apply_surcharges: boolean
  effective_from:   string
  effective_to:     string | null
}

const LINE_KIND_LABELS: Record<LineKind, string> = {
  'SERV-PEC':  'Prise en charge',
  'SERV-KM':   'Kilomètre',
  'SERV-PARC': 'Frais de parc',
  'SERV-MAJ':  'Majoration',
  'SERV-DIV':  'Divers',
}

interface ExtractedTariff {
  source:                string
  mission_type:          string
  unit_price:            number | null
  km_inclus:             number
  km_price:              number | null
  km_basis:              'charged' | 'total'
  parc_day_price:        number | null
  surcharge_night_pct:   number
  surcharge_we_pct:      number
  surcharge_holiday_pct: number
  conditions:            string
  is_autofac:            boolean
  effective_from:        string
  raw_quote:             string
}

const MISSION_TYPES = ['remorquage', 'depannage', 'trajet_vide', 'parc']

const TYPE_LABELS: Record<string, string> = {
  remorquage: '🚛 Remorquage', depannage: '🔧 Dépannage', trajet_vide: '📍 Trajet vide', parc: '🅿️ Mise en parc',
}

export default function TarifsClient(props: Props) {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSource, setFilterSource] = useState<string>('')
  const [view, setView] = useState<'tariffs' | 'rules'>('tariffs')
  const [sources, setSources] = useState<{ source: string; label: string }[]>([])
  const SOURCE_LABELS = Object.fromEntries(sources.map(s => [s.source, s.label]))

  // Fetch dynamique des sources connues (mission_sources + incoming_missions)
  useEffect(() => {
    fetch('/api/admin/tarifs/sources')
      .then(r => r.json())
      .then(j => setSources(j.sources || []))
      .catch(() => setSources([]))
  }, [])

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadHint, setUploadHint] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Text describe modal state (equivalent texte du PDF)
  const [showTextModal, setShowTextModal] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [textHint, setTextHint] = useState<string>('')
  const [textExtracting, setTextExtracting] = useState(false)
  const [textError, setTextError] = useState<string | null>(null)

  // Validation modal state (après extraction IA)
  const [showValidation, setShowValidation] = useState(false)
  const [extractedItems, setExtractedItems] = useState<(ExtractedTariff & { _include: boolean })[]>([])
  const [extractDocPath, setExtractDocPath] = useState<string | null>(null)
  const [extractDocName, setExtractDocName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Edit modal (édition individuelle ou création manuelle)
  const [editTariff, setEditTariff] = useState<Partial<Tariff> | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Brackets viewer + editor modal
  const [bracketsModal, setBracketsModal] = useState<Tariff | null>(null)
  const [bracketsList, setBracketsList] = useState<Bracket[]>([])
  const [bracketsLoading, setBracketsLoading] = useState(false)
  const [bracketEdit, setBracketEdit] = useState<Bracket | null>(null)  // édition d'une tranche
  const [bracketSaving, setBracketSaving] = useState(false)
  const [bracketsBeyondEdit, setBracketsBeyondEdit] = useState(false)   // édition des params beyond_max
  const [showAddBracket, setShowAddBracket] = useState(false)
  const [newBracket, setNewBracket] = useState<{ from_km: string; to_km: string; price_normal: string; price_majore: string }>({
    from_km: '', to_km: '', price_normal: '', price_majore: '',
  })

  async function openBrackets(t: Tariff) {
    setBracketsModal(t)
    setBracketsLoading(true)
    setBracketsList([])
    setBracketEdit(null)
    setShowAddBracket(false)
    try {
      const res = await fetch(`/api/admin/tarifs/${t.id}/brackets`)
      const j = await res.json()
      if (res.ok) setBracketsList(j.brackets || [])
    } catch {}
    setBracketsLoading(false)
  }

  async function reloadBrackets() {
    if (!bracketsModal) return
    try {
      const res = await fetch(`/api/admin/tarifs/${bracketsModal.id}/brackets`)
      const j = await res.json()
      if (res.ok) setBracketsList(j.brackets || [])
    } catch {}
  }

  async function saveBracketEdit() {
    if (!bracketEdit) return
    setBracketSaving(true)
    try {
      const res = await fetch(`/api/admin/tarifs/brackets/${bracketEdit.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from_km:      bracketEdit.from_km,
          to_km:        bracketEdit.to_km,
          price_normal: bracketEdit.price_normal,
          price_majore: bracketEdit.price_majore,
        }),
      })
      const j = await res.json()
      if (!res.ok) { alert(`Erreur : ${j.error}`); return }
      setBracketEdit(null)
      await reloadBrackets()
    } finally { setBracketSaving(false) }
  }

  async function deleteBracket(b: Bracket) {
    if (!confirm(`Supprimer la tranche ${b.from_km}-${b.to_km} km ?`)) return
    try {
      const res = await fetch(`/api/admin/tarifs/brackets/${b.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Erreur : ${j.error}`); return
      }
      await reloadBrackets()
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    }
  }

  async function createBracket() {
    if (!bracketsModal) return
    const fromKm = parseFloat(newBracket.from_km)
    const toKm   = parseFloat(newBracket.to_km)
    const pn     = parseFloat(newBracket.price_normal)
    const pm     = parseFloat(newBracket.price_majore)
    if (!Number.isFinite(fromKm) || !Number.isFinite(toKm) || toKm < fromKm) {
      alert('Plage km invalide'); return
    }
    if (!Number.isFinite(pn) || !Number.isFinite(pm)) {
      alert('Prix invalides'); return
    }
    try {
      const res = await fetch('/api/admin/tarifs/brackets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          source:         bracketsModal.source,
          mission_type:   bracketsModal.mission_type,
          from_km:        fromKm,
          to_km:          toKm,
          price_normal:   pn,
          price_majore:   pm,
          effective_from: bracketsModal.effective_from,
        }),
      })
      const j = await res.json()
      if (!res.ok) { alert(`Erreur : ${j.error}`); return }
      setShowAddBracket(false)
      setNewBracket({ from_km: '', to_km: '', price_normal: '', price_majore: '' })
      await reloadBrackets()
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    }
  }

  // Lines viewer + editor modal (mode "lines" template)
  const [linesModal, setLinesModal] = useState<Tariff | null>(null)
  const [linesList, setLinesList] = useState<TariffLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [newLine, setNewLine] = useState<Partial<TariffLine>>({ kind: 'SERV-PEC', name: '', position: 0, default_qty: 1, default_price: 0, apply_surcharges: true })

  async function openLines(t: Tariff) {
    setLinesModal(t)
    setLinesLoading(true)
    setLinesList([])
    setShowAddLine(false)
    try {
      const res = await fetch(`/api/admin/tarifs/${t.id}/lines`)
      const j = await res.json()
      if (res.ok) setLinesList(j.lines || [])
    } catch {}
    setLinesLoading(false)
  }

  async function reloadLines() {
    if (!linesModal) return
    try {
      const res = await fetch(`/api/admin/tarifs/${linesModal.id}/lines`)
      const j = await res.json()
      if (res.ok) setLinesList(j.lines || [])
    } catch {}
  }

  async function updateLine(line: TariffLine, patch: Partial<TariffLine>) {
    const res = await fetch(`/api/admin/tarifs/lines/${line.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    })
    const j = await res.json()
    if (!res.ok) { alert(`Erreur : ${j.error}`); return }
    await reloadLines()
  }

  async function deleteLine(line: TariffLine) {
    if (!confirm(`Supprimer la ligne "${line.name}" ?`)) return
    const res = await fetch(`/api/admin/tarifs/lines/${line.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`Erreur : ${j.error}`); return
    }
    await reloadLines()
  }

  async function createLine() {
    if (!linesModal) return
    if (!newLine.name || !newLine.kind) { alert('Kind + nom requis'); return }
    const res = await fetch('/api/admin/tarifs/lines', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        source:           linesModal.source,
        mission_type:     linesModal.mission_type,
        position:         newLine.position ?? (linesList.length),
        kind:             newLine.kind,
        name:             newLine.name,
        default_qty:      newLine.default_qty,
        default_price:    newLine.default_price,
        apply_surcharges: newLine.apply_surcharges,
      }),
    })
    const j = await res.json()
    if (!res.ok) { alert(`Erreur : ${j.error}`); return }
    setShowAddLine(false)
    setNewLine({ kind: 'SERV-PEC', name: '', position: 0, default_qty: 1, default_price: 0, apply_surcharges: true })
    await reloadLines()
  }

  async function saveBeyondMax() {
    if (!bracketsModal) return
    setBracketSaving(true)
    try {
      const res = await fetch(`/api/admin/tarifs/${bracketsModal.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          beyond_max_km:         bracketsModal.beyond_max_km,
          beyond_max_step_km:    bracketsModal.beyond_max_step_km,
          beyond_max_step_price: bracketsModal.beyond_max_step_price,
        }),
      })
      const j = await res.json()
      if (!res.ok) { alert(`Erreur : ${j.error}`); return }
      // Update local + tariffs list
      setTariffs(prev => prev.map(t => t.id === bracketsModal.id ? j.tariff : t))
      setBracketsModal(j.tariff)
      setBracketsBeyondEdit(false)
    } finally { setBracketSaving(false) }
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTariffs = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSource) params.set('source', filterSource)
    fetch('/api/admin/tarifs?' + params.toString())
      .then(r => r.json())
      .then(j => { if (j.tariffs) setTariffs(j.tariffs) })
      .catch(e => console.error('[tarifs] load error:', e))
      .finally(() => setLoading(false))
  }

  useEffect(loadTariffs, [filterSource])

  const handleExtract = async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      if (uploadHint) fd.append('hint_source', uploadHint)

      const res = await fetch('/api/admin/tarifs/extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setUploadError(data.error || 'Erreur extraction')
        return
      }
      setExtractedItems((data.extracted as ExtractedTariff[]).map(x => ({ ...x, _include: true })))
      setExtractDocPath(data.document_path)
      setExtractDocName(data.document_name)
      setShowUpload(false)
      setShowValidation(true)
    } catch (e: any) {
      setUploadError(String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  const handleExtractText = async () => {
    if (!textInput.trim()) return
    setTextExtracting(true)
    setTextError(null)
    try {
      const res = await fetch('/api/admin/tarifs/extract-text', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: textInput, hint_source: textHint || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setTextError(data.error || 'Erreur extraction'); return }
      if (!data.extracted || data.extracted.length === 0) {
        setTextError('Aucun tarif identifié. Reformule ou sois plus précis.')
        return
      }
      setExtractedItems((data.extracted as ExtractedTariff[]).map(x => ({ ...x, _include: true })))
      setExtractDocPath(null)
      setExtractDocName(null)
      setShowTextModal(false)
      setShowValidation(true)
    } catch (e: any) {
      setTextError(String(e?.message || e))
    } finally {
      setTextExtracting(false)
    }
  }

  const handleSaveExtracted = async () => {
    const toSave = extractedItems.filter(x => x._include).map(({ _include, ...rest }) => rest)
    if (toSave.length === 0) {
      alert('Aucune ligne sélectionnée')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/tarifs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tariffs:       toSave,
          document_path: extractDocPath,
          document_name: extractDocName,
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert('Erreur: ' + (data.error || 'inconnu')); return }
      setShowValidation(false)
      setExtractedItems([])
      setUploadFile(null)
      setUploadHint('')
      loadTariffs()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Désactiver ce tarif (sera marqué effective_to = aujourd\'hui) ?')) return
    const res = await fetch(`/api/admin/tarifs/${id}`, { method: 'DELETE' })
    if (res.ok) loadTariffs()
  }

  const openNewManual = () => {
    setEditTariff({
      source:                filterSource || 'autre',
      mission_type:          'depannage',
      unit_price:            null,
      km_inclus:             0,
      km_price:              null,
      km_basis:              'charged',
      parc_day_price:        null,
      surcharge_night_pct:   0,
      surcharge_we_pct:      0,
      surcharge_holiday_pct: 0,
      conditions:            '',
      is_autofac:            false,
      effective_from:        new Date().toISOString().slice(0, 10),
      pricing_mode:          'forfait',
      beyond_max_km:         null,
      beyond_max_step_km:    null,
      beyond_max_step_price: null,
    })
  }

  const handleEditSave = async () => {
    if (!editTariff) return
    setEditSaving(true)
    try {
      if (editTariff.id) {
        // Update existant
        const res = await fetch(`/api/admin/tarifs/${editTariff.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(editTariff),
        })
        if (!res.ok) { alert('Erreur: ' + (await res.json()).error); return }
      } else {
        // Create new
        const res = await fetch('/api/admin/tarifs', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ tariffs: [editTariff] }),
        })
        if (!res.ok) { alert('Erreur: ' + (await res.json()).error); return }
      }
      setEditTariff(null)
      loadTariffs()
    } finally {
      setEditSaving(false)
    }
  }

  const formatPrice = (n: number | null) => n != null ? `${n.toFixed(2)} €` : '—'

  return (
    <AppShell
      title="Tarifs assistance"
      userRole={props.userRole}
      userName={props.userName}
      userEmail={props.userEmail}
      userId={props.userId}
      userModules={props.userModules}
    >
      <div className="space-y-4 max-w-6xl mx-auto p-4">
        {/* ── Toggle Tarifs / Règles dynamiques ─────────────── */}
        <div className="flex gap-2 border-b border-surface-hover">
          <button
            onClick={() => setView('tariffs')}
            className={`px-4 py-2 text-sm font-medium ${view === 'tariffs' ? 'text-brand border-b-2 border-brand' : 'text-ink-faint'}`}
          >
            📋 Tarifs de base
          </button>
          <button
            onClick={() => setView('rules')}
            className={`px-4 py-2 text-sm font-medium ${view === 'rules' ? 'text-brand border-b-2 border-brand' : 'text-ink-faint'}`}
          >
            🤖 Règles dynamiques
          </button>
        </div>

        {view === 'rules' && <RulesPanel />}

        {view === 'tariffs' && <>
        {/* ── Onglets par source ─────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          <SourceTab active={filterSource === ''} label="Toutes" count={null} onClick={() => setFilterSource('')} />
          {sources.map(s => {
            const count = tariffs.filter(t => t.source === s.source).length
            return <SourceTab key={s.source} active={filterSource === s.source} label={s.label} count={filterSource === '' ? count : null} onClick={() => setFilterSource(s.source)} />
          })}
        </div>

        {/* ── Actions ────────────────────────────────────────── */}
        <div className="bg-surface p-3 rounded-lg flex flex-wrap gap-2 items-center">
          <div className="text-sm text-ink-faint">
            {filterSource ? `${tariffs.length} tarif${tariffs.length !== 1 ? 's' : ''} ${SOURCE_LABELS[filterSource] || filterSource}` : `${tariffs.length} tarifs au total`}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={openNewManual} className="px-4 py-2 bg-surface-hover text-ink rounded font-medium text-sm border border-surface-hover hover:border-brand transition">
              + Ajouter manuellement
            </button>
            <button onClick={() => setShowTextModal(true)} className="px-4 py-2 bg-surface-hover text-ink rounded font-medium text-sm border border-surface-hover hover:border-brand transition">
              📝 Décrire en texte
            </button>
            <button onClick={() => setShowUpload(true)} className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm">
              📄 Importer un PDF
            </button>
          </div>
        </div>

        {loading && <div className="text-center text-ink-faint py-8">Chargement…</div>}

        {!loading && tariffs.length === 0 && (
          <div className="bg-surface p-8 rounded-lg text-center text-ink-faint">
            Aucun tarif enregistré. Clique sur "Importer un PDF" pour commencer, ou ajoute des tarifs manuellement via SQL.
          </div>
        )}

        {!loading && tariffs.length > 0 && (
          <div className="bg-surface rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-faint uppercase tracking-wider bg-surface-hover">
                <tr>
                  <th className="text-left p-2">Source</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Forfait</th>
                  <th className="text-right p-2">Km inclus</th>
                  <th className="text-right p-2">€/km extra</th>
                  <th className="text-right p-2">Parc/jour</th>
                  <th className="text-center p-2">Surch. nuit/WE/JF</th>
                  <th className="text-center p-2">Autofac</th>
                  <th className="text-center p-2">Effective</th>
                  <th className="text-center p-2"></th>
                </tr>
              </thead>
              <tbody>
                {tariffs.map(t => {
                  const isBrackets = t.pricing_mode === 'brackets'
                  const isLines    = t.pricing_mode === 'lines'
                  return (
                    <tr key={t.id} className="border-t border-surface-hover hover:bg-surface-hover/50 cursor-pointer"
                        onClick={() => isBrackets ? openBrackets(t) : isLines ? openLines(t) : setEditTariff(t)}>
                      <td className="p-2 font-medium">{SOURCE_LABELS[t.source] || t.source}</td>
                      <td className="p-2">{TYPE_LABELS[t.mission_type] || t.mission_type}</td>
                      {isBrackets ? (
                        <td colSpan={5} className="p-2 text-center">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-info/15 text-info border border-info/30 rounded-md text-xs font-semibold">
                            📊 Tarif par tranches de km
                          </span>
                          <span className="text-ink-faint text-xs ml-2">
                            Au-delà de {t.beyond_max_km} km : +{Number(t.beyond_max_step_price || 0).toFixed(2)} €/{t.beyond_max_step_km} km
                          </span>
                        </td>
                      ) : isLines ? (
                        <td colSpan={5} className="p-2 text-center">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/15 text-purple-600 border border-purple-500/30 rounded-md text-xs font-semibold">
                            📋 Lignes pré-configurées
                          </span>
                          <span className="text-ink-faint text-xs ml-2">
                            Set de prestations — qty/PU édités à la facturation
                          </span>
                        </td>
                      ) : (
                        <>
                          <td className="p-2 text-right">{formatPrice(t.unit_price)}</td>
                          <td className="p-2 text-right">{t.km_inclus || '—'}</td>
                          <td className="p-2 text-right">{formatPrice(t.km_price)}</td>
                          <td className="p-2 text-right">{formatPrice(t.parc_day_price)}</td>
                          <td className="p-2 text-center text-xs">{t.surcharge_night_pct || 0}/{t.surcharge_we_pct || 0}/{t.surcharge_holiday_pct || 0}</td>
                        </>
                      )}
                      <td className="p-2 text-center">{t.is_autofac ? '✓' : '—'}</td>
                      <td className="p-2 text-center text-xs">{t.effective_from}{t.effective_to ? ` → ${t.effective_to}` : ''}</td>
                      <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                        {t.source_document_path && (
                          <a
                            href={`/api/admin/tarifs/document?path=${encodeURIComponent(t.source_document_path)}`}
                            target="_blank"
                            rel="noopener"
                            title="Voir le PDF source"
                            className="inline-block mr-2"
                          >
                            📄
                          </a>
                        )}
                        <button onClick={() => handleDelete(t.id)} title="Désactiver" className="text-red-500">🗑️</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Text describe modal ───────────────────────────── */}
        {showTextModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg p-6 max-w-2xl w-full">
              <h2 className="text-lg font-display font-bold mb-2">📝 Décrire un barème en texte</h2>
              <p className="text-xs text-ink-faint mb-4">
                Écris en français le barème comme tu le décrirais au téléphone. L'IA va extraire les tarifs structurés.
                Tu pourras valider/ajuster avant enregistrement.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-ink-faint uppercase tracking-wider">Source (optionnel)</label>
                  <select value={textHint} onChange={e => setTextHint(e.target.value)} className="w-full mt-1 px-3 py-2 bg-surface-hover rounded">
                    <option value="">Auto (laisse l'IA détecter)</option>
                    {sources.map(s => <option key={s.source} value={s.source}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-ink-faint uppercase tracking-wider">Barème</label>
                  <textarea
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    rows={10}
                    placeholder={`Exemples :

• "TGR Touring : remorquage 2.00€/km chargé (incident → destination), pas de forfait"

• "Privé : remorquage 75€ forfait incluant 20 km, puis 2.50€/km extra sur le total parcouru. Mise en parc 10€/jour."

• "AXA : DSP forfait 65€, REM forfait 95€ + 1.80€/km au-delà de 25 km inclus. Autofacturation. Valide à partir du 1er juin 2026."`}
                    className="w-full mt-1 px-3 py-2 bg-surface-hover rounded text-sm font-mono"
                  />
                </div>
                {textError && <div className="text-red-500 text-sm">{textError}</div>}
                {textExtracting && <div className="text-ink-faint text-sm">⏳ Analyse IA en cours (5-15s)…</div>}
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setShowTextModal(false)} disabled={textExtracting} className="flex-1 px-4 py-2 bg-surface-hover rounded text-sm">
                  Annuler
                </button>
                <button onClick={handleExtractText} disabled={!textInput.trim() || textExtracting} className="flex-1 px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50">
                  {textExtracting ? '⏳ Analyse…' : '🤖 Interpréter avec IA'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Upload modal ──────────────────────────────────── */}
        {showUpload && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-display font-bold mb-4">📄 Importer un PDF tarifaire</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-ink-faint uppercase tracking-wider">Source (optionnel, aide l'IA)</label>
                  <select value={uploadHint} onChange={e => setUploadHint(e.target.value)} className="w-full mt-1 px-3 py-2 bg-surface-hover rounded">
                    <option value="">Auto (laisse l'IA détecter)</option>
                    {sources.map(s => <option key={s.source} value={s.source}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-ink-faint uppercase tracking-wider">PDF</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full mt-1 px-3 py-2 bg-surface-hover rounded text-sm"
                  />
                </div>
                {uploadError && <div className="text-red-500 text-sm">{uploadError}</div>}
                {uploading && <div className="text-ink-faint text-sm">Analyse IA en cours (10-30s)…</div>}
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setShowUpload(false)} disabled={uploading} className="flex-1 px-4 py-2 bg-surface-hover rounded text-sm">
                  Annuler
                </button>
                <button onClick={handleExtract} disabled={!uploadFile || uploading} className="flex-1 px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50">
                  {uploading ? '⏳ Analyse…' : '🤖 Analyser avec IA'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Validation modal ──────────────────────────────── */}
        {showValidation && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-display font-bold mb-2">✅ Validation extraction IA</h2>
              <p className="text-sm text-ink-faint mb-4">
                {extractedItems.length} ligne(s) extraite(s) depuis <code className="text-xs">{extractDocName}</code>.
                Décoche les lignes incorrectes, ajuste les valeurs si besoin, puis enregistre.
              </p>

              {extractedItems.length === 0 ? (
                <div className="text-center py-8 text-ink-faint">
                  Aucun tarif identifié par l'IA. Tu peux ajouter manuellement ou ajuster le PDF.
                </div>
              ) : (
                <div className="space-y-3">
                  {extractedItems.map((item, idx) => (
                    <div key={idx} className={`p-3 rounded border ${item._include ? 'border-brand bg-brand/5' : 'border-surface-hover opacity-50'}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={item._include}
                          onChange={e => {
                            const next = [...extractedItems]
                            next[idx]._include = e.target.checked
                            setExtractedItems(next)
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                          <FieldSelect label="Source" value={item.source} options={sources.map(s => s.source)} onChange={v => updateField(idx, 'source', v)} />
                          <FieldSelect label="Type" value={item.mission_type} options={MISSION_TYPES} onChange={v => updateField(idx, 'mission_type', v)} />
                          <FieldNumber label="Forfait €" value={item.unit_price} onChange={v => updateField(idx, 'unit_price', v)} />
                          <FieldNumber label="Km inclus" value={item.km_inclus} onChange={v => updateField(idx, 'km_inclus', v)} />
                          <FieldNumber label="€/km extra" value={item.km_price} onChange={v => updateField(idx, 'km_price', v)} />
                          <FieldNumber label="€/jour parc" value={item.parc_day_price} onChange={v => updateField(idx, 'parc_day_price', v)} />
                          <div className="col-span-2 lg:col-span-4">
                            <label className="text-[10px] text-ink-faint uppercase tracking-wider">Base de calcul des km</label>
                            <select
                              value={item.km_basis || 'charged'}
                              onChange={e => updateField(idx, 'km_basis', e.target.value)}
                              className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
                            >
                              <option value="charged">Km chargés (incident → destination) — assurances</option>
                              <option value="total">Km totaux (dépôt → ... → retour) — privé / garage</option>
                            </select>
                          </div>
                          <div className="col-span-2 lg:col-span-4">
                            <p className="text-[10px] text-ink-faint italic">
                              💡 Les majorations nuit/week-end/jour férié sont gérées séparément par le module Surcharges (selon l'heure réelle de l'intervention).
                            </p>
                          </div>
                          <div className="col-span-2 lg:col-span-4">
                            <label className="text-xs text-ink-faint flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={item.is_autofac}
                                onChange={e => updateField(idx, 'is_autofac', e.target.checked)}
                              />
                              Autofacturation (l'assurance facture elle-même)
                            </label>
                          </div>
                          {item.raw_quote && (
                            <div className="col-span-2 lg:col-span-4 text-xs text-ink-faint italic border-l-2 border-brand/30 pl-2 mt-1">
                              "{item.raw_quote}"
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-6 sticky bottom-0 bg-surface pt-3 border-t border-surface-hover">
                <button onClick={() => setShowValidation(false)} disabled={saving} className="px-4 py-2 bg-surface-hover rounded text-sm">
                  Annuler
                </button>
                <div className="flex-1 text-center text-sm text-ink-faint self-center">
                  {extractedItems.filter(x => x._include).length} ligne(s) à enregistrer
                </div>
                <button onClick={handleSaveExtracted} disabled={saving || extractedItems.filter(x => x._include).length === 0} className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50">
                  {saving ? '⏳ Enregistrement…' : '✅ Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}
        </>}

        {/* ── Edit modal ────────────────────────────────────── */}
        {editTariff && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !editSaving && setEditTariff(null)}>
            <div className="bg-surface rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-display font-bold mb-4">
                {editTariff.id ? '✏️ Modifier le tarif' : '➕ Nouveau tarif manuel'}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <FieldSelect label="Source" value={editTariff.source || ''} options={sources.map(s => s.source)} onChange={v => setEditTariff(p => ({ ...p!, source: v }))} />
                <FieldSelect label="Type mission" value={editTariff.mission_type || ''} options={MISSION_TYPES} onChange={v => setEditTariff(p => ({ ...p!, mission_type: v }))} />

                {/* Toggle pricing mode : forfait vs brackets vs lines */}
                <div className="col-span-2 bg-info/5 border border-info/30 rounded p-2">
                  <label className="text-[10px] text-info uppercase tracking-wider font-semibold">Mode de tarification</label>
                  <div className="flex flex-col gap-1.5 mt-1.5 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="pricing_mode"
                        checked={(editTariff.pricing_mode || 'forfait') === 'forfait'}
                        onChange={() => setEditTariff(p => ({ ...p!, pricing_mode: 'forfait' }))}
                      />
                      <span>📐 <strong>Forfait</strong> (forfait + km supp + majorations classiques)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="pricing_mode"
                        checked={editTariff.pricing_mode === 'brackets'}
                        onChange={() => setEditTariff(p => ({ ...p!, pricing_mode: 'brackets' }))}
                      />
                      <span>📊 <strong>Tranches de km</strong> (IPA style, majoration intégrée)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="pricing_mode"
                        checked={editTariff.pricing_mode === 'lines'}
                        onChange={() => setEditTariff(p => ({ ...p!, pricing_mode: 'lines' }))}
                      />
                      <span>📋 <strong>Lignes pré-configurées</strong> (set de prestations, qty/PU saisies à la facturation)</span>
                    </label>
                  </div>
                </div>

                {/* Champs forfait — masques si mode brackets */}
                {(editTariff.pricing_mode || 'forfait') === 'forfait' && (
                  <>
                    <FieldNumber label="Forfait €" value={editTariff.unit_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, unit_price: v }))} />
                    <FieldNumber label="Km inclus" value={editTariff.km_inclus ?? 0} onChange={v => setEditTariff(p => ({ ...p!, km_inclus: v ?? 0 }))} />
                    <FieldNumber label="€/km extra" value={editTariff.km_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, km_price: v }))} />
                    <FieldNumber label="€/jour parc" value={editTariff.parc_day_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, parc_day_price: v }))} />
                  </>
                )}

                {/* Champs brackets — visible si mode brackets */}
                {editTariff.pricing_mode === 'brackets' && (
                  <>
                    <FieldNumber label="Limite max (km)" value={editTariff.beyond_max_km ?? null} onChange={v => setEditTariff(p => ({ ...p!, beyond_max_km: v }))} />
                    <FieldNumber label="Pas au-delà (km)" value={editTariff.beyond_max_step_km ?? null} onChange={v => setEditTariff(p => ({ ...p!, beyond_max_step_km: v }))} />
                    <FieldNumber label="€ / pas" value={editTariff.beyond_max_step_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, beyond_max_step_price: v }))} />
                    <FieldNumber label="€/jour parc (optionnel)" value={editTariff.parc_day_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, parc_day_price: v }))} />
                    <div className="col-span-2 bg-warning/5 border border-warning/30 rounded p-2 text-xs text-ink-faint">
                      ⚠️ Après création, clique sur la ligne dans le tableau pour ajouter les tranches (from_km, to_km, prix normal, prix majoré).
                    </div>
                  </>
                )}

                {/* Mode lines : pas de champ structurel, juste un hint */}
                {editTariff.pricing_mode === 'lines' && (
                  <div className="col-span-2 bg-warning/5 border border-warning/30 rounded p-2 text-xs text-ink-faint">
                    ⚠️ Après création, clique sur la ligne dans le tableau pour ajouter les lignes pré-configurées (kind + nom + qty/PU par défaut).
                    La ligne <strong>SERV-MAJ</strong> sera ajoutée automatiquement à la facturation si une majoration est applicable (matrice surcharges).
                  </div>
                )}

                <div className="col-span-2">
                  <label className="text-[10px] text-ink-faint uppercase tracking-wider">Base de calcul des km</label>
                  <select
                    value={editTariff.km_basis || 'charged'}
                    onChange={e => setEditTariff(p => ({ ...p!, km_basis: e.target.value as 'charged' | 'total' }))}
                    className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
                  >
                    <option value="charged">Km chargés (incident → destination) — assurances</option>
                    <option value="total">Km totaux (dépôt → incident → destination → retour) — privé / garage / IPA</option>
                  </select>
                </div>
                <div className="col-span-2 bg-brand/5 border border-brand/20 rounded p-2 text-xs text-ink-faint">
                  💡 <strong>Majorations</strong> (mode Forfait) gérées par le module <a href="/admin/surcharges" className="underline">Surcharges</a>. En mode Tranches, les majorations sont intégrées dans le prix majoré de chaque bracket (selon heure d'appel &lt; 7h, ≥ 18h, sa, di, JF BE).
                </div>
                <div>
                  <label className="text-[10px] text-ink-faint uppercase tracking-wider">Effective from</label>
                  <input
                    type="date"
                    value={editTariff.effective_from || ''}
                    onChange={e => setEditTariff(p => ({ ...p!, effective_from: e.target.value }))}
                    className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-ink-faint uppercase tracking-wider">Effective to (vide = en vigueur)</label>
                  <input
                    type="date"
                    value={editTariff.effective_to || ''}
                    onChange={e => setEditTariff(p => ({ ...p!, effective_to: e.target.value || null }))}
                    className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-ink-faint uppercase tracking-wider">Conditions / Notes</label>
                  <textarea
                    value={editTariff.conditions || ''}
                    onChange={e => setEditTariff(p => ({ ...p!, conditions: e.target.value }))}
                    rows={2}
                    className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-ink-faint flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editTariff.is_autofac || false}
                      onChange={e => setEditTariff(p => ({ ...p!, is_autofac: e.target.checked }))}
                    />
                    Autofacturation (l'assurance facture elle-même, pas de facture Odoo VD)
                  </label>
                </div>
                {editTariff.notes && (
                  <div className="col-span-2 text-xs text-ink-faint italic border-l-2 border-brand/30 pl-2">
                    {editTariff.notes}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setEditTariff(null)} disabled={editSaving} className="flex-1 px-4 py-2 bg-surface-hover rounded text-sm">
                  Annuler
                </button>
                <button onClick={handleEditSave} disabled={editSaving} className="flex-1 px-4 py-2 bg-brand text-surface rounded font-medium text-sm disabled:opacity-50">
                  {editSaving ? '⏳ Enregistrement…' : (editTariff.id ? '💾 Modifier' : '➕ Créer')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Brackets editor modal (tarifs IPA en mode "brackets") ─────────── */}
        {bracketsModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg p-6 max-w-3xl w-full max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-display font-bold">
                    📊 Tarif par tranches — {SOURCE_LABELS[bracketsModal.source] || bracketsModal.source} · {TYPE_LABELS[bracketsModal.mission_type] || bracketsModal.mission_type}
                  </h2>
                  <p className="text-xs text-ink-faint mt-1">
                    En vigueur depuis {bracketsModal.effective_from}
                  </p>
                </div>
                <button onClick={() => setBracketsModal(null)} className="text-ink-faint hover:text-ink text-xl">×</button>
              </div>

              {/* Paramètres au-delà du max (editables) */}
              <div className="bg-surface-hover/50 rounded p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-ink-secondary uppercase tracking-wider">Au-delà du maximum</p>
                  {!bracketsBeyondEdit ? (
                    <button onClick={() => setBracketsBeyondEdit(true)} className="text-xs text-info hover:underline">✏️ Modifier</button>
                  ) : (
                    <div className="flex gap-1">
                      <button onClick={saveBeyondMax} disabled={bracketSaving} className="text-xs px-2 py-0.5 bg-brand text-surface rounded disabled:opacity-50">{bracketSaving ? '…' : '✓'}</button>
                      <button onClick={() => setBracketsBeyondEdit(false)} className="text-xs px-2 py-0.5 bg-surface-hover rounded">✕</button>
                    </div>
                  )}
                </div>
                {bracketsBeyondEdit ? (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <label className="text-ink-faint">Limite max (km)</label>
                      <input type="number" value={bracketsModal.beyond_max_km ?? ''} onChange={e => setBracketsModal({ ...bracketsModal, beyond_max_km: e.target.value === '' ? null : parseInt(e.target.value, 10) })} className="w-full mt-1 px-2 py-1 bg-surface rounded" />
                    </div>
                    <div>
                      <label className="text-ink-faint">Pas (km)</label>
                      <input type="number" value={bracketsModal.beyond_max_step_km ?? ''} onChange={e => setBracketsModal({ ...bracketsModal, beyond_max_step_km: e.target.value === '' ? null : parseInt(e.target.value, 10) })} className="w-full mt-1 px-2 py-1 bg-surface rounded" />
                    </div>
                    <div>
                      <label className="text-ink-faint">€ / pas</label>
                      <input type="number" step="0.01" value={bracketsModal.beyond_max_step_price ?? ''} onChange={e => setBracketsModal({ ...bracketsModal, beyond_max_step_price: e.target.value === '' ? null : parseFloat(e.target.value) })} className="w-full mt-1 px-2 py-1 bg-surface rounded" />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-ink-secondary">
                    Au-delà de <strong>{bracketsModal.beyond_max_km ?? '—'} km</strong> : +<strong>{Number(bracketsModal.beyond_max_step_price || 0).toFixed(2).replace('.', ',')} €</strong> par tranche de <strong>{bracketsModal.beyond_max_step_km ?? '—'} km</strong>
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {bracketsLoading ? (
                  <p className="text-center text-ink-faint py-8">⏳ Chargement…</p>
                ) : bracketsList.length === 0 ? (
                  <p className="text-center text-ink-faint py-8">Aucune tranche. Clique "+ Ajouter" ci-dessous.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-ink-faint uppercase tracking-wider bg-surface-hover sticky top-0 z-10">
                      <tr>
                        <th className="text-left p-2">Tranche (km)</th>
                        <th className="text-right p-2">Prix normal (HT)</th>
                        <th className="text-right p-2">Prix majoré (HT)</th>
                        <th className="text-right p-2 w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bracketsList.map(b => {
                        const isEditing = bracketEdit?.id === b.id
                        if (isEditing) {
                          return (
                            <tr key={b.id} className="border-t border-surface-hover bg-info/5">
                              <td className="p-1">
                                <div className="flex items-center gap-1">
                                  <input type="number" value={bracketEdit.from_km} onChange={e => setBracketEdit({ ...bracketEdit, from_km: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 bg-surface rounded text-sm" />
                                  <span>-</span>
                                  <input type="number" value={bracketEdit.to_km} onChange={e => setBracketEdit({ ...bracketEdit, to_km: parseFloat(e.target.value) || 0 })} className="w-20 px-2 py-1 bg-surface rounded text-sm" />
                                </div>
                              </td>
                              <td className="p-1 text-right">
                                <input type="number" step="0.01" value={bracketEdit.price_normal} onChange={e => setBracketEdit({ ...bracketEdit, price_normal: parseFloat(e.target.value) || 0 })} className="w-24 px-2 py-1 bg-surface rounded text-sm text-right" />
                              </td>
                              <td className="p-1 text-right">
                                <input type="number" step="0.01" value={bracketEdit.price_majore} onChange={e => setBracketEdit({ ...bracketEdit, price_majore: parseFloat(e.target.value) || 0 })} className="w-24 px-2 py-1 bg-surface rounded text-sm text-right" />
                              </td>
                              <td className="p-1 text-right">
                                <button onClick={saveBracketEdit} disabled={bracketSaving} className="text-xs px-2 py-1 bg-brand text-surface rounded mr-1 disabled:opacity-50">{bracketSaving ? '…' : '✓'}</button>
                                <button onClick={() => setBracketEdit(null)} className="text-xs px-2 py-1 bg-surface-hover rounded">✕</button>
                              </td>
                            </tr>
                          )
                        }
                        const diff = Number(b.price_majore) - Number(b.price_normal)
                        return (
                          <tr key={b.id} className="border-t border-surface-hover hover:bg-surface-hover/30">
                            <td className="p-2 font-mono">{b.from_km} - {b.to_km}</td>
                            <td className="p-2 text-right">{Number(b.price_normal).toFixed(2).replace('.', ',')} €</td>
                            <td className="p-2 text-right text-warning">{Number(b.price_majore).toFixed(2).replace('.', ',')} € <span className="text-ink-faint text-xs">(+{diff.toFixed(2).replace('.', ',')})</span></td>
                            <td className="p-2 text-right">
                              <button onClick={() => setBracketEdit(b)} className="text-info hover:underline text-xs mr-2">✏️</button>
                              <button onClick={() => deleteBracket(b)} className="text-red-500 hover:underline text-xs">🗑️</button>
                            </td>
                          </tr>
                        )
                      })}
                      {/* Ligne d'ajout */}
                      {showAddBracket && (
                        <tr className="border-t border-surface-hover bg-success/5">
                          <td className="p-1">
                            <div className="flex items-center gap-1">
                              <input type="number" placeholder="from" value={newBracket.from_km} onChange={e => setNewBracket({ ...newBracket, from_km: e.target.value })} className="w-20 px-2 py-1 bg-surface rounded text-sm" />
                              <span>-</span>
                              <input type="number" placeholder="to" value={newBracket.to_km} onChange={e => setNewBracket({ ...newBracket, to_km: e.target.value })} className="w-20 px-2 py-1 bg-surface rounded text-sm" />
                            </div>
                          </td>
                          <td className="p-1 text-right">
                            <input type="number" step="0.01" placeholder="0,00" value={newBracket.price_normal} onChange={e => setNewBracket({ ...newBracket, price_normal: e.target.value })} className="w-24 px-2 py-1 bg-surface rounded text-sm text-right" />
                          </td>
                          <td className="p-1 text-right">
                            <input type="number" step="0.01" placeholder="0,00" value={newBracket.price_majore} onChange={e => setNewBracket({ ...newBracket, price_majore: e.target.value })} className="w-24 px-2 py-1 bg-surface rounded text-sm text-right" />
                          </td>
                          <td className="p-1 text-right">
                            <button onClick={createBracket} className="text-xs px-2 py-1 bg-brand text-surface rounded mr-1">✓</button>
                            <button onClick={() => { setShowAddBracket(false); setNewBracket({ from_km: '', to_km: '', price_normal: '', price_majore: '' }) }} className="text-xs px-2 py-1 bg-surface-hover rounded">✕</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-surface-hover flex items-center justify-between text-xs">
                <span className="text-ink-faint">
                  Majoration : heure d'appel &lt; 7h, ≥ 18h, samedi, dimanche, JF BE
                </span>
                <button
                  onClick={() => setShowAddBracket(true)}
                  disabled={showAddBracket}
                  className="px-3 py-1.5 bg-success/15 text-success border border-success/30 rounded text-xs font-medium hover:bg-success/25 disabled:opacity-50"
                >
                  + Ajouter une tranche
                </button>
              </div>

              <div className="mt-3 flex justify-end">
                <button onClick={() => setBracketsModal(null)} className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm">
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Lines editor modal (mode "lines" template) ──────────── */}
        {linesModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg p-6 max-w-4xl w-full max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-display font-bold">
                    📋 Lignes pré-configurées — {SOURCE_LABELS[linesModal.source] || linesModal.source} · {TYPE_LABELS[linesModal.mission_type] || linesModal.mission_type}
                  </h2>
                  <p className="text-xs text-ink-faint mt-1">
                    Ces lignes seront pré-chargées dans le devis Odoo. L'employé ajustera qty / PU lors de la facturation.
                    La ligne <strong>SERV-MAJ</strong> est ajoutée automatiquement si majoration applicable.
                  </p>
                </div>
                <button onClick={() => setLinesModal(null)} className="text-ink-faint hover:text-ink text-xl">×</button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {linesLoading ? (
                  <p className="text-center text-ink-faint py-8">⏳ Chargement…</p>
                ) : linesList.length === 0 && !showAddLine ? (
                  <p className="text-center text-ink-faint py-8">Aucune ligne. Clique "+ Ajouter" ci-dessous.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-ink-faint uppercase tracking-wider bg-surface-hover sticky top-0 z-10">
                      <tr>
                        <th className="text-center p-2 w-12">#</th>
                        <th className="text-left p-2 w-28">Kind</th>
                        <th className="text-left p-2">Description</th>
                        <th className="text-right p-2 w-20">Qté défaut</th>
                        <th className="text-right p-2 w-24">PU défaut</th>
                        <th className="text-center p-2 w-20">Majorable ?</th>
                        <th className="text-right p-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {linesList.map(line => (
                        <tr key={line.id} className="border-t border-surface-hover hover:bg-surface-hover/30">
                          <td className="p-2 text-center text-ink-faint">{line.position}</td>
                          <td className="p-2">
                            <select
                              value={line.kind}
                              onChange={e => updateLine(line, { kind: e.target.value as LineKind })}
                              className="bg-surface border rounded px-1 py-0.5 text-xs w-full"
                            >
                              {(Object.keys(LINE_KIND_LABELS) as LineKind[]).map(k => (
                                <option key={k} value={k}>{k} — {LINE_KIND_LABELS[k]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              defaultValue={line.name}
                              onBlur={e => e.target.value !== line.name && updateLine(line, { name: e.target.value })}
                              className="bg-surface border rounded px-2 py-0.5 text-xs w-full"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={line.default_qty ?? ''}
                              onBlur={e => {
                                const v = e.target.value === '' ? null : parseFloat(e.target.value)
                                if (v !== line.default_qty) updateLine(line, { default_qty: v })
                              }}
                              placeholder="—"
                              className="bg-surface border rounded px-1 py-0.5 text-xs w-full text-right"
                            />
                          </td>
                          <td className="p-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={line.default_price ?? ''}
                              onBlur={e => {
                                const v = e.target.value === '' ? null : parseFloat(e.target.value)
                                if (v !== line.default_price) updateLine(line, { default_price: v })
                              }}
                              placeholder="—"
                              className="bg-surface border rounded px-1 py-0.5 text-xs w-full text-right"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={line.apply_surcharges}
                              onChange={e => updateLine(line, { apply_surcharges: e.target.checked })}
                            />
                          </td>
                          <td className="p-2 text-right">
                            <button onClick={() => deleteLine(line)} className="text-red-500 hover:underline text-xs">🗑️</button>
                          </td>
                        </tr>
                      ))}
                      {/* Ligne d'ajout */}
                      {showAddLine && (
                        <tr className="border-t border-surface-hover bg-success/5">
                          <td className="p-2">
                            <input type="number" value={newLine.position ?? 0} onChange={e => setNewLine({ ...newLine, position: parseInt(e.target.value, 10) || 0 })} className="bg-surface border rounded px-1 py-0.5 text-xs w-full text-center" />
                          </td>
                          <td className="p-2">
                            <select value={newLine.kind} onChange={e => setNewLine({ ...newLine, kind: e.target.value as LineKind })} className="bg-surface border rounded px-1 py-0.5 text-xs w-full">
                              {(Object.keys(LINE_KIND_LABELS) as LineKind[]).map(k => (
                                <option key={k} value={k}>{k} — {LINE_KIND_LABELS[k]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <input type="text" placeholder="Description" value={newLine.name || ''} onChange={e => setNewLine({ ...newLine, name: e.target.value })} className="bg-surface border rounded px-2 py-0.5 text-xs w-full" />
                          </td>
                          <td className="p-2 text-right">
                            <input type="number" step="0.01" placeholder="qty" value={newLine.default_qty ?? ''} onChange={e => setNewLine({ ...newLine, default_qty: e.target.value === '' ? null : parseFloat(e.target.value) })} className="bg-surface border rounded px-1 py-0.5 text-xs w-full text-right" />
                          </td>
                          <td className="p-2 text-right">
                            <input type="number" step="0.01" placeholder="PU" value={newLine.default_price ?? ''} onChange={e => setNewLine({ ...newLine, default_price: e.target.value === '' ? null : parseFloat(e.target.value) })} className="bg-surface border rounded px-1 py-0.5 text-xs w-full text-right" />
                          </td>
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={newLine.apply_surcharges ?? true} onChange={e => setNewLine({ ...newLine, apply_surcharges: e.target.checked })} />
                          </td>
                          <td className="p-2 text-right">
                            <button onClick={createLine} className="text-xs px-2 py-1 bg-brand text-surface rounded mr-1">✓</button>
                            <button onClick={() => { setShowAddLine(false); setNewLine({ kind: 'SERV-PEC', name: '', position: 0, default_qty: 1, default_price: 0, apply_surcharges: true }) }} className="text-xs px-2 py-1 bg-surface-hover rounded">✕</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-surface-hover flex items-center justify-between">
                <p className="text-xs text-ink-faint">
                  💡 Tip : laisse <em>qty défaut</em> ou <em>PU défaut</em> vide si l'employé doit toujours saisir la valeur.
                </p>
                <button
                  onClick={() => setShowAddLine(true)}
                  disabled={showAddLine}
                  className="px-3 py-1.5 bg-success/15 text-success border border-success/30 rounded text-xs font-medium hover:bg-success/25 disabled:opacity-50"
                >
                  + Ajouter une ligne
                </button>
              </div>

              <div className="mt-3 flex justify-end">
                <button onClick={() => setLinesModal(null)} className="px-4 py-2 bg-brand text-surface rounded font-medium text-sm">
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )

  function updateField(idx: number, field: string, value: any) {
    setExtractedItems(prev => {
      const next = [...prev]
      ;(next[idx] as any)[field] = value
      return next
    })
  }
}

function SourceTab({ active, label, count, onClick }: { active: boolean; label: string; count: number | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-t font-medium text-sm whitespace-nowrap transition-colors ${
        active
          ? 'bg-surface text-brand border-b-2 border-brand'
          : 'bg-surface-hover text-ink-secondary hover:text-ink'
      }`}
    >
      {label}{count != null && ` (${count})`}
    </button>
  )
}

function FieldNumber({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="text-[10px] text-ink-faint uppercase tracking-wider">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full px-2 py-1 bg-surface-hover rounded text-sm"
      />
    </div>
  )
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] text-ink-faint uppercase tracking-wider">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-2 py-1 bg-surface-hover rounded text-sm">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
