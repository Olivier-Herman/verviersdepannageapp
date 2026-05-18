'use client'

import { useEffect, useState, useRef } from 'react'
import AppShell from '@/components/layout/AppShell'

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
}

interface ExtractedTariff {
  source:                string
  mission_type:          string
  unit_price:            number | null
  km_inclus:             number
  km_price:              number | null
  parc_day_price:        number | null
  surcharge_night_pct:   number
  surcharge_we_pct:      number
  surcharge_holiday_pct: number
  conditions:            string
  is_autofac:            boolean
  effective_from:        string
  raw_quote:             string
}

const SOURCES = ['vab', 'touring', 'ima', 'mondial', 'ethias', 'autre']
const MISSION_TYPES = ['remorquage', 'depannage', 'trajet_vide', 'parc']

const SOURCE_LABELS: Record<string, string> = {
  vab: 'VAB', touring: 'Touring', ima: 'IMA', mondial: 'Mondial', ethias: 'Ethias', autre: 'Autre',
}
const TYPE_LABELS: Record<string, string> = {
  remorquage: '🚛 Remorquage', depannage: '🔧 Dépannage', trajet_vide: '📍 Trajet vide', parc: '🅿️ Mise en parc',
}

export default function TarifsClient(props: Props) {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSource, setFilterSource] = useState<string>('')

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadHint, setUploadHint] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Validation modal state (après extraction IA)
  const [showValidation, setShowValidation] = useState(false)
  const [extractedItems, setExtractedItems] = useState<(ExtractedTariff & { _include: boolean })[]>([])
  const [extractDocPath, setExtractDocPath] = useState<string | null>(null)
  const [extractDocName, setExtractDocName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Edit modal (édition individuelle ou création manuelle)
  const [editTariff, setEditTariff] = useState<Partial<Tariff> | null>(null)
  const [editSaving, setEditSaving] = useState(false)

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
      parc_day_price:        null,
      surcharge_night_pct:   0,
      surcharge_we_pct:      0,
      surcharge_holiday_pct: 0,
      conditions:            '',
      is_autofac:            false,
      effective_from:        new Date().toISOString().slice(0, 10),
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
        {/* ── Onglets par source ─────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          <SourceTab active={filterSource === ''} label="Toutes" count={null} onClick={() => setFilterSource('')} />
          {SOURCES.map(s => {
            const count = tariffs.filter(t => t.source === s).length
            // Quand on est sur "Toutes", on affiche le count par source. Sinon, count = visible.
            return <SourceTab key={s} active={filterSource === s} label={SOURCE_LABELS[s]} count={filterSource === '' ? count : null} onClick={() => setFilterSource(s)} />
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
                {tariffs.map(t => (
                  <tr key={t.id} className="border-t border-surface-hover hover:bg-surface-hover/50 cursor-pointer" onClick={() => setEditTariff(t)}>
                    <td className="p-2 font-medium">{SOURCE_LABELS[t.source] || t.source}</td>
                    <td className="p-2">{TYPE_LABELS[t.mission_type] || t.mission_type}</td>
                    <td className="p-2 text-right">{formatPrice(t.unit_price)}</td>
                    <td className="p-2 text-right">{t.km_inclus || '—'}</td>
                    <td className="p-2 text-right">{formatPrice(t.km_price)}</td>
                    <td className="p-2 text-right">{formatPrice(t.parc_day_price)}</td>
                    <td className="p-2 text-center text-xs">{t.surcharge_night_pct || 0}/{t.surcharge_we_pct || 0}/{t.surcharge_holiday_pct || 0}</td>
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
                ))}
              </tbody>
            </table>
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
                    {SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
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
                          <FieldSelect label="Source" value={item.source} options={SOURCES} onChange={v => updateField(idx, 'source', v)} />
                          <FieldSelect label="Type" value={item.mission_type} options={MISSION_TYPES} onChange={v => updateField(idx, 'mission_type', v)} />
                          <FieldNumber label="Forfait €" value={item.unit_price} onChange={v => updateField(idx, 'unit_price', v)} />
                          <FieldNumber label="Km inclus" value={item.km_inclus} onChange={v => updateField(idx, 'km_inclus', v)} />
                          <FieldNumber label="€/km extra" value={item.km_price} onChange={v => updateField(idx, 'km_price', v)} />
                          <FieldNumber label="€/jour parc" value={item.parc_day_price} onChange={v => updateField(idx, 'parc_day_price', v)} />
                          <FieldNumber label="Nuit %" value={item.surcharge_night_pct} onChange={v => updateField(idx, 'surcharge_night_pct', v)} />
                          <FieldNumber label="WE %" value={item.surcharge_we_pct} onChange={v => updateField(idx, 'surcharge_we_pct', v)} />
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
        {/* ── Edit modal ────────────────────────────────────── */}
        {editTariff && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !editSaving && setEditTariff(null)}>
            <div className="bg-surface rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-display font-bold mb-4">
                {editTariff.id ? '✏️ Modifier le tarif' : '➕ Nouveau tarif manuel'}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <FieldSelect label="Source" value={editTariff.source || ''} options={SOURCES} onChange={v => setEditTariff(p => ({ ...p!, source: v }))} />
                <FieldSelect label="Type mission" value={editTariff.mission_type || ''} options={MISSION_TYPES} onChange={v => setEditTariff(p => ({ ...p!, mission_type: v }))} />
                <FieldNumber label="Forfait €" value={editTariff.unit_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, unit_price: v }))} />
                <FieldNumber label="Km inclus" value={editTariff.km_inclus ?? 0} onChange={v => setEditTariff(p => ({ ...p!, km_inclus: v ?? 0 }))} />
                <FieldNumber label="€/km extra" value={editTariff.km_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, km_price: v }))} />
                <FieldNumber label="€/jour parc" value={editTariff.parc_day_price ?? null} onChange={v => setEditTariff(p => ({ ...p!, parc_day_price: v }))} />
                <FieldNumber label="Surcharge nuit %" value={editTariff.surcharge_night_pct ?? 0} onChange={v => setEditTariff(p => ({ ...p!, surcharge_night_pct: v ?? 0 }))} />
                <FieldNumber label="Surcharge WE %" value={editTariff.surcharge_we_pct ?? 0} onChange={v => setEditTariff(p => ({ ...p!, surcharge_we_pct: v ?? 0 }))} />
                <FieldNumber label="Surcharge JF %" value={editTariff.surcharge_holiday_pct ?? 0} onChange={v => setEditTariff(p => ({ ...p!, surcharge_holiday_pct: v ?? 0 }))} />
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
